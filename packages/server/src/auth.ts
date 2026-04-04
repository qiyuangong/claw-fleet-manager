import { URL } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { UserService } from './services/user.js';

const PROXY_TOKEN_SECRET = randomBytes(32);
const PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface FailedAttempt {
  count: number;
  resetAt: number;
}

interface AuthOptions {
  maxFailedAttempts?: number;
  windowMs?: number;
  secure?: boolean;
}

function getProxyTokenPayload(expires: number, instanceId: string): string {
  return `${expires}.${instanceId}`;
}

function parseProxyInstanceId(urlPath: string): string | null {
  const match = urlPath.match(/^\/proxy(?:-ws)?\/([^/?]+)/);
  return match?.[1] ?? null;
}

export function generateProxyToken(instanceId: string): string {
  const expires = Date.now() + PROXY_TOKEN_TTL_MS;
  const payload = getProxyTokenPayload(expires, instanceId);
  const encodedInstanceId = Buffer.from(instanceId, 'utf-8').toString('base64url');
  const sig = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  return `${expires}.${encodedInstanceId}.${sig}`;
}

export function validateProxyToken(token: string, instanceId: string): boolean {
  const [expiresRaw, encodedInstanceId, sig] = token.split('.');
  if (!expiresRaw || !encodedInstanceId || !sig) return false;
  const expires = parseInt(expiresRaw, 10);
  if (isNaN(expires) || Date.now() > expires) return false;
  let tokenInstanceId: string;
  try {
    tokenInstanceId = Buffer.from(encodedInstanceId, 'base64url').toString('utf-8');
  } catch {
    return false;
  }
  if (tokenInstanceId !== instanceId) return false;
  const expected = createHmac('sha256', PROXY_TOKEN_SECRET)
    .update(getProxyTokenPayload(expires, tokenInstanceId))
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function parseBasicAuth(header?: string): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function parseWebSocketQueryAuth(urlPath: string): { username: string; password: string } | null {
  try {
    const url = new URL(urlPath, 'http://localhost');
    const encoded = url.searchParams.get('auth');
    if (!encoded) return null;
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function parseProxyCookie(cookieHeader: string | undefined, cookieName: string): { username: string; password: string } | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${cookieName}=`)) {
      const encoded = trimmed.slice(cookieName.length + 1);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return null;
        return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function registerAuth(
  app: FastifyInstance,
  userService: UserService,
  options: AuthOptions = {},
) {
  const proxyCookieName = 'x-fleet-proxy-auth';
  const {
    maxFailedAttempts = 20,
    windowMs = 15 * 60 * 1000,
    secure = false,
  } = options;

  const failedAttempts = new Map<string, FailedAttempt>();

  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of failedAttempts) {
      if (now >= entry.resetAt) {
        failedAttempts.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  pruneInterval.unref();

  function isRateLimited(ip: string): boolean {
    const entry = failedAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() >= entry.resetAt) {
      failedAttempts.delete(ip);
      return false;
    }
    return entry.count >= maxFailedAttempts;
  }

  function recordFailure(ip: string): void {
    const now = Date.now();
    const entry = failedAttempts.get(ip);
    if (!entry || now >= entry.resetAt) {
      failedAttempts.set(ip, { count: 1, resetAt: now + windowMs });
      return;
    }

    failedAttempts.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
  }

  function rejectUnauthorized(reply: { header: (name: string, value: string) => unknown }, rawUrl: string, clientIp: string) {
    recordFailure(clientIp);
    const suppressBrowserPrompt =
      rawUrl.startsWith('/api/')
      || rawUrl.startsWith('/ws/')
      || rawUrl.startsWith('/proxy/')
      || rawUrl.startsWith('/proxy-ws/');

    if (!suppressBrowserPrompt) {
      reply.header('www-authenticate', 'Basic realm="Claw Fleet Manager"');
    }
    return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const setProxyCookie = (reply: { header: (name: string, value: string) => unknown }, encoded: string) => {
    const securePart = secure ? '; Secure' : '';
    reply.header(
      'set-cookie',
      `${proxyCookieName}=${encoded}; Path=/proxy; HttpOnly; SameSite=Strict${securePart}`,
    );
  };

  app.addHook('onRequest', async (request, reply) => {
    const rawUrl = request.raw.url ?? '/';
    const isApiPath = rawUrl.startsWith('/api/');
    const isWsPath = rawUrl.startsWith('/ws/');
    const isProxyPath = rawUrl.startsWith('/proxy/') || rawUrl.startsWith('/proxy-ws/');

    // Let the SPA shell and static assets load without browser-level auth prompts.
    if (!isApiPath && !isWsPath && !isProxyPath) {
      return;
    }

    const clientIp = request.ip;
    if (isRateLimited(clientIp)) {
      return reply.status(429).send({ error: 'Too many failed attempts', code: 'RATE_LIMITED' });
    }

    const headerCredentials = parseBasicAuth(request.headers.authorization);
    if (headerCredentials) {
      const user = await userService.verify(headerCredentials.username, headerCredentials.password);
      if (user) {
        request.user = user;
        setProxyCookie(reply, request.headers.authorization!.slice(6));
        return;
      }
    }

    if (isProxyPath || isWsPath) {
      const cookieCredentials = parseProxyCookie(request.headers.cookie, proxyCookieName);
      if (cookieCredentials) {
        const user = await userService.verify(cookieCredentials.username, cookieCredentials.password);
        if (user) {
          request.user = user;
          return;
        }
      }

      if (isProxyPath) {
        const proxyToken = new URL(rawUrl, 'http://localhost').searchParams.get('proxyToken');
        const proxyInstanceId = parseProxyInstanceId(rawUrl);
        if (proxyToken && proxyInstanceId && validateProxyToken(proxyToken, proxyInstanceId)) {
          return;
        }
      }

      const queryCredentials = parseWebSocketQueryAuth(rawUrl);
      if (queryCredentials) {
        const user = await userService.verify(queryCredentials.username, queryCredentials.password);
        if (user) {
          request.user = user;
          const encoded = rawUrl.match(/[?&]auth=([^&]*)/)?.[1] ?? '';
          if (encoded) setProxyCookie(reply, encoded);
          return;
        }
      }
    }

    return rejectUnauthorized(reply, rawUrl, clientIp);
  });
}
