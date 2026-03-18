import { URL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import type { ServerConfig } from './types.js';

function parseBasicAuth(header?: string): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
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
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isAuthorized(
  credentials: { username: string; password: string } | null,
  config: ServerConfig,
): boolean {
  return Boolean(
    credentials
    && credentials.username === config.auth.username
    && credentials.password === config.auth.password,
  );
}

export async function registerAuth(app: FastifyInstance, config: ServerConfig) {
  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== config.auth.username || password !== config.auth.password) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'Claw Fleet Manager' },
  });

  app.addHook('onRequest', async (request, reply) => {
    const headerCredentials = parseBasicAuth(request.headers.authorization);
    if (isAuthorized(headerCredentials, config)) {
      return;
    }

    const rawUrl = request.raw.url ?? '/';
    if (rawUrl.startsWith('/ws/')) {
      const queryCredentials = parseWebSocketQueryAuth(rawUrl);
      if (isAuthorized(queryCredentials, config)) {
        return;
      }
    }

    reply.header('www-authenticate', 'Basic realm="Claw Fleet Manager"');
    return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
}
