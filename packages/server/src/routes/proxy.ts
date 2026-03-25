import { URL } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { request as undiciRequest } from 'undici';
import WebSocket from 'ws';
import { generateProxyToken } from '../auth.js';

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
      // Drop the upstream CSP entirely — we inject an inline script and the
      // proxy origin already provides its own security boundary.
      continue;
    }

    out[key] = value;
  }

  return out;
}

type ProxyParams = { Params: { id: string; '*': string | undefined } };
type ProxyWildcardParams = { Params: { '*': string } };

function findInstance(app: FastifyInstance, id: string) {
  return app.backend.getCachedStatus()?.instances.find((instance) => instance.id === id);
}

function toProxyPath(request: FastifyRequest<ProxyParams>): string {
  const rawUrl = new URL(request.raw.url ?? '/', 'http://localhost');
  rawUrl.searchParams.delete('auth');
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

function parseProxyWildcardPath(request: FastifyRequest<ProxyWildcardParams>) {
  const raw = request.params['*'] ?? '';
  const [id, ...rest] = raw.split('/').filter(Boolean);
  if (!id) return null;
  const rawUrl = new URL(request.raw.url ?? '/', 'http://localhost');
  rawUrl.searchParams.delete('auth');
  const suffix = rest.length > 0 ? `/${rest.join('/')}` : '/';
  return { id, path: `${suffix}${rawUrl.search}` };
}

function findWildcardInstance(app: FastifyInstance, request: FastifyRequest<ProxyWildcardParams>) {
  const parsed = parseProxyWildcardPath(request);
  if (!parsed) return null;
  const instance = findInstance(app, parsed.id);
  if (!instance) return { parsed, instance: null };
  return { parsed, instance };
}

function buildInjectedScript(token: string, proxyToken: string): string {
  return (
    `<script>(function(){` +
    `var t=${JSON.stringify(token)};` +
    `var a=${JSON.stringify(proxyToken)};` +
    `var s='openclaw.control.settings.v1';` +
    `var p='openclaw.control.token.v1:';` +
    `function n(u){` +
    `var v=(u||'').trim();` +
    `if(!v)return'default';` +
    `try{var w=new URL(v,window.location.href);` +
    `var x=w.pathname==='/'?'':(w.pathname.replace(/\\/+$/,'')||w.pathname);` +
    `return w.protocol+'//'+w.host+x;}catch{return v;}}` +
    `function g(){` +
    `var u=window.location.protocol==='https:'?'wss':'ws';` +
    `var v=(window.location.pathname||'/').replace(/\\/+$/,'');` +
    `return u+'://'+window.location.host+(v&&v!=='/'?v:'');}` +
    `function h(){` +
    `var u=g();` +
    `try{sessionStorage.removeItem('openclaw.control.token.v1');` +
    `sessionStorage.setItem(p+n(u),t);}catch{}` +
    `try{var v={};` +
    `try{v=JSON.parse(localStorage.getItem(s)||'{}')||{};}catch{}` +
    `v.gatewayUrl=u;` +
    `localStorage.setItem(s,JSON.stringify(v));}catch{}` +
    `return u;}` +
    `var k=h();` +
    `var o=sessionStorage.getItem.bind(sessionStorage);` +
    `sessionStorage.getItem=function(u){var v=o(u);if(v!==null)return v;if(u===p+n(k)||u.startsWith(p))return t;return null};` +
    `var W=window.WebSocket;` +
    `function withAuth(url){` +
    `try{var u=new URL(url,window.location.href);` +
    `if(u.pathname.startsWith('/proxy/'))u.searchParams.set('proxyToken',a);` +
    `return u.toString();}catch{return url;}}` +
    `function P(url,protocols){` +
    `var next=withAuth(url);` +
    `return protocols===undefined?new W(next):new W(next,protocols);}` +
    `P.prototype=W.prototype;` +
    `Object.defineProperties(P,{` +
    `CONNECTING:{value:W.CONNECTING},OPEN:{value:W.OPEN},` +
    `CLOSING:{value:W.CLOSING},CLOSED:{value:W.CLOSED}` +
    `});` +
    `window.WebSocket=P;` +
    `})();</script>`
  );
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

    const safeHeaders = stripFrameHeaders(
      response.headers as Record<string, string | string[] | undefined>,
    );

    // For HTML responses, inject a sessionStorage interceptor so the Control UI
    // finds the gateway token automatically (the UI stores it in sessionStorage keyed
    // by gatewayUrl, which differs between the direct port and the proxy URL).
    if (String(safeHeaders['content-type'] ?? '').toLowerCase().includes('text/html')) {
      const token = (instance.index !== undefined ? app.fleetConfig.readTokens()[instance.index] : undefined) ?? '';
      if (token) {
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
        }
        const html = Buffer.concat(chunks).toString('utf-8');
        // The embedded Control UI needs both the gateway token and the manager's
        // Basic Auth credentials for its proxied websocket bootstrap.
        const script = buildInjectedScript(token, generateProxyToken());
        const injected = html.includes('</head>')
          ? html.replace('</head>', script + '</head>')
          : script + html;
        const buf = Buffer.from(injected, 'utf-8');
        delete safeHeaders['content-length'];
        reply.status(response.statusCode).headers(safeHeaders);
        return reply.send(buf);
      }
    }

    reply.status(response.statusCode).headers(safeHeaders);
    return reply.send(response.body);
  }

  async function httpWildcardProxy(
    request: FastifyRequest<ProxyWildcardParams>,
    reply: FastifyReply,
  ) {
    const resolved = findWildcardInstance(app, request);
    if (!resolved) {
      return reply.status(400).send({ error: 'Invalid proxy path', code: 'INVALID_PROXY_PATH' });
    }

    if (!resolved.instance) {
      return reply.status(404).send({
        error: `Instance ${resolved.parsed.id} not found`,
        code: 'INSTANCE_NOT_FOUND',
      });
    }

    const nextUrl = `/proxy/${resolved.parsed.id}${resolved.parsed.path}`;
    request.raw.url = nextUrl;
    (request.params as any) = {
      id: resolved.parsed.id,
      '*': resolved.parsed.path === '/' ? undefined : resolved.parsed.path.slice(1).split('?')[0],
    };

    return httpProxy(request as unknown as FastifyRequest<ProxyParams>, reply);
  }

  const wsProxy = (socket: any, request: FastifyRequest<ProxyWildcardParams>) => {
      const parsed = parseProxyWildcardPath(request);
      if (!parsed) {
        socket.close(1008, 'Invalid proxy path');
        return;
      }

      const instance = findInstance(app, parsed.id);
      if (!instance) {
        socket.close(1011, 'Instance not found');
        return;
      }

      socket._socket?.on('error', () => {
        // Ignore raw socket resets from browser disconnects or failed upgrades.
      });

      const upstream = new WebSocket(
        `ws://127.0.0.1:${instance.port}${parsed.path}`,
        {
          headers: {
            origin: `http://localhost:${instance.port}`,
          },
        },
      );

      upstream.on('open', () => {
        (upstream as any)._socket?.on('error', () => {
          // Ignore raw socket resets after the upstream handshake.
        });
      });

      socket.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(message, { binary: isBinary });
        }
      });

      upstream.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
        try {
          socket.send(message, { binary: isBinary });
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
    };

  const wsProxyById = (
    socket: any,
    request: FastifyRequest<{ Params: { id: string } }>,
  ) => {
    request.raw.url = `/proxy/${request.params.id}/`;
    (request.params as any) = { '*': request.params.id };
    wsProxy(socket, request as unknown as FastifyRequest<ProxyWildcardParams>);
  };

  app.route<{ Params: { id: string } }>({
    method: 'GET',
    url: '/proxy/:id',
    handler: async (request, reply) => {
      const instance = findInstance(app, request.params.id);
      if (!instance) {
        return reply.status(404).send({
          error: `Instance ${request.params.id} not found`,
          code: 'INSTANCE_NOT_FOUND',
        });
      }

      return reply.redirect(`/proxy/${request.params.id}/`);
    },
    wsHandler: wsProxyById,
  });

  app.route<ProxyWildcardParams>({
    method: 'GET',
    url: '/proxy/*',
    handler: httpWildcardProxy,
    wsHandler: wsProxy,
  });

  for (const url of ['/proxy/:id', '/proxy/:id/*']) {
    app.route<ProxyParams>({
      method: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      url,
      handler: httpProxy,
    });
  }
}
