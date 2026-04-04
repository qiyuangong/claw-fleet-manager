import { URL } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
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

  app.addHook('onClose', async () => {
    clearInterval(pruneInterval);
  });

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

  function sendUnauthorized(reply: FastifyReply, rawUrl: string) {
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

  function logAuthFailure(request: { log: { warn: (payload: object, message: string) => void } }, clientIp: string, rawUrl: string) {
    request.log.warn(
      { audit: true, event: 'auth_failed', ip: clientIp, path: rawUrl },
      'Authentication failed',
    );
  }

  function logAuthSuccess(request: { log: { info: (payload: object, message: string) => void } }, clientIp: string, username: string) {
    request.log.info(
      { audit: true, event: 'auth_success', ip: clientIp, username },
      'Authentication succeeded',
    );
  }

  const setProxyCookie = (reply: FastifyReply, encoded: string) => {
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
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const basicHeader = request.headers.authorization;
    const hasBasicAuthAttempt = typeof basicHeader === 'string' && basicHeader.startsWith('Basic ');
    const proxyToken = isProxyPath ? parsedUrl.searchParams.get('proxyToken') : null;
    const proxyInstanceId = isProxyPath ? parseProxyInstanceId(rawUrl) : null;
    const hasProxyToken = Boolean(proxyToken && proxyInstanceId && validateProxyToken(proxyToken, proxyInstanceId));
    if (hasProxyToken) {
      return;
    }

    const hasProxyCookieAttempt = isProxyPath || isWsPath
      ? (request.headers.cookie?.includes(`${proxyCookieName}=`) ?? false)
      : false;
    const hasQueryAuthAttempt = (isProxyPath || isWsPath) && parsedUrl.searchParams.has('auth');
    const hasCredentialAttempt = hasBasicAuthAttempt || hasProxyCookieAttempt || hasQueryAuthAttempt;
    let recordedFailure = false;
    const noteFailure = () => {
      if (!recordedFailure) {
        recordFailure(clientIp);
        recordedFailure = true;
      }
    };

    if (hasCredentialAttempt && isRateLimited(clientIp)) {
      logAuthFailure(request, clientIp, rawUrl);
      return reply.status(429).send({ error: 'Too many failed attempts', code: 'RATE_LIMITED' });
    }

    const headerCredentials = parseBasicAuth(request.headers.authorization);
    if (hasBasicAuthAttempt) {
      if (headerCredentials) {
        const user = await userService.verify(headerCredentials.username, headerCredentials.password);
        if (user) {
          request.user = user;
          logAuthSuccess(request, clientIp, user.username);
          setProxyCookie(reply, request.headers.authorization!.slice(6));
          return;
        }
      }
      noteFailure();
    }

    if (isProxyPath || isWsPath) {
      const cookieCredentials = parseProxyCookie(request.headers.cookie, proxyCookieName);
      if (hasProxyCookieAttempt) {
        if (cookieCredentials) {
          const user = await userService.verify(cookieCredentials.username, cookieCredentials.password);
          if (user) {
            request.user = user;
            logAuthSuccess(request, clientIp, user.username);
            return;
          }
        }
        noteFailure();
      }

      if (hasQueryAuthAttempt) {
        const queryCredentials = parseWebSocketQueryAuth(rawUrl);
        if (queryCredentials) {
          const user = await userService.verify(queryCredentials.username, queryCredentials.password);
          if (user) {
            request.user = user;
            logAuthSuccess(request, clientIp, user.username);
            const encoded = rawUrl.match(/[?&]auth=([^&]*)/)?.[1] ?? '';
            if (encoded) setProxyCookie(reply, encoded);
            return;
          }
        }
        noteFailure();
      }
    }

    logAuthFailure(request, clientIp, rawUrl);
    return sendUnauthorized(reply, rawUrl);
  });
}
