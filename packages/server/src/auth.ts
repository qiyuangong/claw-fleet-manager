import { URL } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { UserService } from './services/user.js';

const PROXY_TOKEN_SECRET = randomBytes(32);
const PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateProxyToken(): string {
  const expires = Date.now() + PROXY_TOKEN_TTL_MS;
  const payload = String(expires);
  const sig = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function validateProxyToken(token: string): boolean {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expires = parseInt(payload, 10);
  if (isNaN(expires) || Date.now() > expires) return false;
  const expected = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
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

export async function registerAuth(app: FastifyInstance, userService: UserService) {
  const proxyCookieName = 'x-fleet-proxy-auth';

  app.addHook('onRequest', async (request, reply) => {
    const headerCredentials = parseBasicAuth(request.headers.authorization);
    if (headerCredentials) {
      const user = await userService.verify(headerCredentials.username, headerCredentials.password);
      if (user) {
        request.user = user;
        return;
      }
    }

    const rawUrl = request.raw.url ?? '/';
    const isProxyPath =
      rawUrl.startsWith('/ws/')
      || rawUrl.startsWith('/proxy/')
      || rawUrl.startsWith('/proxy-ws/');

    if (isProxyPath) {
      const cookieCredentials = parseProxyCookie(request.headers.cookie, proxyCookieName);
      if (cookieCredentials) {
        const user = await userService.verify(cookieCredentials.username, cookieCredentials.password);
        if (user) {
          request.user = user;
          return;
        }
      }

      const proxyToken = new URL(rawUrl, 'http://localhost').searchParams.get('proxyToken');
      if (proxyToken && validateProxyToken(proxyToken)) {
        // proxyToken path — token was issued server-side after a real auth; treat as admin-level.
        // We must set request.user to a synthetic admin-like object so that any preHandlers
        // (requireProfileAccess on /ws/logs/:id) don't 403 due to missing request.user.
        request.user = { username: '__proxytoken__', passwordHash: '', role: 'admin', assignedProfiles: [] };
        return;
      }

      const queryCredentials = parseWebSocketQueryAuth(rawUrl);
      if (queryCredentials) {
        const user = await userService.verify(queryCredentials.username, queryCredentials.password);
        if (user) {
          request.user = user;
          const encoded = rawUrl.match(/[?&]auth=([^&]*)/)?.[1] ?? '';
          if (encoded) {
            reply.header(
              'set-cookie',
              `${proxyCookieName}=${encoded}; Path=/proxy; HttpOnly; SameSite=Strict`,
            );
          }
          return;
        }
      }
    }

    const suppressBrowserPrompt =
      rawUrl.startsWith('/proxy/')
      || rawUrl.startsWith('/proxy-ws/');

    if (!suppressBrowserPrompt) {
      reply.header('www-authenticate', 'Basic realm="Claw Fleet Manager"');
    }
    return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
}
