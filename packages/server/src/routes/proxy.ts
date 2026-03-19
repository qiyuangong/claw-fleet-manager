import { URL } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { request as undiciRequest } from 'undici';
import WebSocket from 'ws';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

export function stripFrameHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;

    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP.has(lowerKey)) continue;
    if (lowerKey === 'x-frame-options') continue;

    if (lowerKey === 'content-security-policy') {
      out[key] = String(value).replace(/frame-ancestors\s+[^;]+/, "frame-ancestors 'self'");
      continue;
    }

    out[key] = value;
  }

  return out;
}

type ProxyParams = { Params: { id: string; '*': string } };

function findInstance(app: FastifyInstance, id: string) {
  return app.monitor.getStatus()?.instances.find((instance) => instance.id === id);
}

function toProxyPath(request: FastifyRequest<ProxyParams>): string {
  const rawUrl = new URL(request.raw.url ?? '/', 'http://localhost');
  const suffix = request.params['*'] ? `/${request.params['*']}` : '/';
  return `${suffix}${rawUrl.search}`;
}

function toRequestBody(request: FastifyRequest): string | Buffer | undefined {
  if (request.body == null) return undefined;
  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    return request.body;
  }
  return JSON.stringify(request.body);
}

export async function proxyRoutes(app: FastifyInstance) {
  async function httpProxy(request: FastifyRequest<ProxyParams>, reply: FastifyReply) {
    const instance = findInstance(app, request.params.id);
    if (!instance) {
      return reply.status(404).send({
        error: `Instance ${request.params.id} not found`,
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    const body = ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())
      ? undefined
      : toRequestBody(request);

    let response: Awaited<ReturnType<typeof undiciRequest>>;
    try {
      response = await undiciRequest(`http://127.0.0.1:${instance.port}${toProxyPath(request)}`, {
        method: request.method as any,
        headers: {
          ...Object.fromEntries(
            Object.entries(request.headers).filter(([key]) => !HOP_BY_HOP.has(key.toLowerCase())),
          ),
          host: `127.0.0.1:${instance.port}`,
          ...(body != null
            ? { 'content-length': Buffer.byteLength(body).toString() }
            : {}),
        },
        body,
      });
    } catch {
      return reply.status(502).send({ error: 'Upstream unreachable', code: 'UPSTREAM_ERROR' });
    }

    reply.status(response.statusCode).headers(
      stripFrameHeaders(response.headers as Record<string, string | string[] | undefined>),
    );

    return reply.send(response.body);
  }

  app.route<ProxyParams>({
    method: 'GET',
    url: '/proxy/:id/*',
    handler: httpProxy,
    wsHandler: (socket: any, request: FastifyRequest<ProxyParams>) => {
      const instance = findInstance(app, request.params.id);
      if (!instance) {
        socket.close(1011, 'Instance not found');
        return;
      }

      const upstream = new WebSocket(
        `ws://127.0.0.1:${instance.port}${toProxyPath(request)}`,
        {
          headers: {
            origin: `http://localhost:${instance.port}`,
          },
        },
      );

      socket.on('message', (message: WebSocket.RawData) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(message);
        }
      });

      upstream.on('message', (message) => {
        try {
          socket.send(message);
        } catch {
          // socket already closed
        }
      });

      socket.on('close', () => {
        upstream.close();
      });

      upstream.on('close', () => {
        try {
          socket.close();
        } catch {
          // socket already closed
        }
      });

      socket.on('error', () => {
        upstream.close();
      });

      upstream.on('error', () => {
        try {
          socket.close(1011, 'Upstream WS error');
        } catch {
          // socket already closed
        }
      });
    },
  });

  app.route<ProxyParams>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/proxy/:id/*',
    handler: httpProxy,
  });
}
