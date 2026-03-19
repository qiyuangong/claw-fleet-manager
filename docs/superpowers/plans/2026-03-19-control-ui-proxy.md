# Control UI Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the OpenClaw gateway's own Control UI inside the fleet manager as a dedicated tab for each instance, bypassing the gateway's iframe-blocking headers via a server-side reverse proxy.

**Architecture:** The Fastify server gains a `/proxy/:id/*` route that forwards HTTP requests to the correct instance port using `undici` (Node built-in), stripping `X-Frame-Options` and rewriting `frame-ancestors` in the CSP so the response can be framed. WebSocket upgrade requests on the same path are bridged to the upstream gateway using `ws`, with the `Origin` header spoofed to satisfy the gateway's `allowedOrigins` check. The React frontend gains a new "controlui" tab in `InstancePanel` that renders a full-height `<iframe>` pointing at `/proxy/<instanceId>/`.

**Tech Stack:** undici (Node 22 built-in), ws (add as direct dep), @fastify/websocket (already installed), React iframe

**Spec/context:** The OpenClaw control UI is served at `http://localhost:<port>/` and returns `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`, so direct iframing is impossible. It also checks the `Origin` header on WebSocket connections against `gateway.controlUi.allowedOrigins` in `openclaw.json`. The proxy solves both problems without touching any instance config file.

---

## File Map

### New files
- `packages/server/src/routes/proxy.ts` — HTTP + WebSocket reverse proxy route for `/proxy/:id/*`
- `packages/server/tests/routes/proxy.test.ts` — route tests (HTTP header stripping, 404 for unknown instance)
- `packages/web/src/components/instances/ControlUiTab.tsx` — iframe embed with loading state + open-in-tab fallback

### Modified files
- `packages/server/package.json` — add `ws` and `@types/ws` as direct dependencies
- `packages/server/src/index.ts` — register proxyRoutes; add `/proxy/` to the NotFoundHandler exclusion list
- `packages/web/vite.config.ts` — add `/proxy` HTTP proxy + `/proxy` WebSocket proxy to dev server
- `packages/web/src/store.ts` — add `'controlui'` to the `Tab` union type
- `packages/web/src/components/instances/InstancePanel.tsx` — add `'controlui'` tab button + lazy-load `ControlUiTab`

---

## Task 1: Server — `ws` dependency + proxy route

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/routes/proxy.ts`
- Create: `packages/server/tests/routes/proxy.test.ts`

### Background

The proxy route must handle two distinct connection types on the same URL pattern:

1. **HTTP requests** (assets, API calls from the control UI JS): forwarded with `undici.request()`. `X-Frame-Options` is deleted from the response; `frame-ancestors 'none'` is rewritten to `frame-ancestors 'self'` in the CSP.

2. **WebSocket upgrades** (real-time communication between control UI and gateway): bridged with two `ws.WebSocket` connections (client↔server, server↔upstream). The upstream connection sets `Origin: http://localhost:<port>` so the gateway's `allowedOrigins` check passes even though the browser's actual origin is `http://localhost:3001`.

`@fastify/websocket` v11 supports co-locating HTTP and WebSocket handlers for the **same GET path** via a single `app.route()` call with both `handler` (for plain HTTP) and `wsHandler` (for WebSocket upgrades) — the plugin routes upgrade requests to `wsHandler` and plain HTTP to `handler`. Two separate `app.route()` / `app.get()` calls for the same path would cause a Fastify duplicate-route error. Non-GET HTTP methods (POST, PUT, etc.) are handled by a second `app.route()` with an explicit method list.

- [ ] **Step 1: Add `ws` and `undici` as direct dependencies**

Edit `packages/server/package.json`, add to `"dependencies"`:
```json
"undici": "^6.0.0",
"ws": "^8.18.0"
```
Add to `"devDependencies"`:
```json
"@types/ws": "^8.5.0"
```

Note: Even though `undici` is bundled with Node 22, adding it as an explicit dependency provides TypeScript types and makes the import resolvable by `tsc --noEmit`.

- [ ] **Step 2: Install**

Run from repo root:
```bash
npm install
```
Expected: Lock file updates, `ws` appears in `packages/server/node_modules`.

- [ ] **Step 3: Write failing tests**

```typescript
// packages/server/tests/routes/proxy.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { proxyRoutes, stripFrameHeaders } from '../../src/routes/proxy.js';

const mockStatus = {
  instances: [
    {
      id: 'openclaw-1',
      index: 1,
      port: 18789,
      status: 'running',
      token: 'abc1***f456',
      uptime: 100,
      cpu: 5,
      memory: { used: 200, limit: 8000 },
      disk: { config: 0, workspace: 0 },
      health: 'healthy',
      image: 'openclaw:local',
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockMonitor = { getStatus: vi.fn().mockReturnValue(mockStatus) };

describe('stripFrameHeaders', () => {
  it('removes X-Frame-Options entirely', () => {
    const result = stripFrameHeaders({ 'x-frame-options': 'DENY', 'content-type': 'text/html' });
    expect(result['x-frame-options']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('rewrites frame-ancestors none to self in CSP', () => {
    const result = stripFrameHeaders({
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    });
    expect(result['content-security-policy']).toBe("default-src 'self'; frame-ancestors 'self'");
  });

  it('preserves CSP directives that do not mention frame-ancestors', () => {
    const result = stripFrameHeaders({
      'content-security-policy': "default-src 'self'",
    });
    expect(result['content-security-policy']).toBe("default-src 'self'");
  });

  it('strips hop-by-hop headers', () => {
    const result = stripFrameHeaders({ 'transfer-encoding': 'chunked', 'content-type': 'text/html' });
    expect(result['transfer-encoding']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('drops undefined values', () => {
    const result = stripFrameHeaders({ 'x-custom': undefined });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('Proxy routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor as any);
    await app.register(fastifyWebsocket);
    await app.register(proxyRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 404 for unknown instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/openclaw-99/' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/routes/proxy.test.ts
```
Expected: FAIL — `Cannot find module '../../src/routes/proxy.js'` (or `stripFrameHeaders is not a function` if the file exists but doesn't export it)

- [ ] **Step 5: Implement `proxy.ts`**

```typescript
// packages/server/src/routes/proxy.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { request as undiciRequest } from 'undici';
import WebSocket from 'ws';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

// Exported for unit testing
export function stripFrameHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const lk = key.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === 'x-frame-options') continue; // strip entirely

    if (lk === 'content-security-policy') {
      // Replace "frame-ancestors 'none'" with "frame-ancestors 'self'" so iframes are allowed
      out[key] = String(value).replace(/frame-ancestors\s+[^;]+/, "frame-ancestors 'self'");
      continue;
    }
    out[key] = value as string | string[];
  }
  return out;
}

type ProxyParams = { Params: { id: string; '*': string } };

export async function proxyRoutes(app: FastifyInstance) {
  // ── HTTP proxy ──────────────────────────────────────────────────────────────
  // Handles all HTTP methods. Registered before the WS route.
  // @fastify/websocket intercepts WS upgrades before they reach this handler,
  // so this handler only ever sees plain HTTP requests.
  async function httpProxy(request: FastifyRequest<ProxyParams>, reply: FastifyReply) {
    const { id } = request.params;
    const instance = app.monitor.getStatus()?.instances.find((i) => i.id === id);
    if (!instance) {
      return reply.status(404).send({ error: `Instance ${id} not found`, code: 'INSTANCE_NOT_FOUND' });
    }

    const subPath = request.params['*'] ? `/${request.params['*']}` : '/';
    const qs = request.url.includes('?') ? `?${request.url.split('?').slice(1).join('?')}` : '';
    const upstream = `http://localhost:${instance.port}${subPath}${qs}`;

    // Re-serialize body for POST/PUT/PATCH; GET/HEAD have no body
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
    const bodyData = hasBody && request.body != null
      ? JSON.stringify(request.body)
      : undefined;

    let response: Awaited<ReturnType<typeof undiciRequest>>;
    try {
      response = await undiciRequest(upstream, {
        method: request.method as Parameters<typeof undiciRequest>[1]['method'],
        headers: {
          ...Object.fromEntries(
            Object.entries(request.headers).filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase()))
          ),
          host: `localhost:${instance.port}`,
          ...(bodyData ? { 'content-length': Buffer.byteLength(bodyData).toString() } : {}),
        },
        body: bodyData,
      });
    } catch {
      return reply.status(502).send({ error: 'Upstream unreachable', code: 'UPSTREAM_ERROR' });
    }

    const safeHeaders = stripFrameHeaders(response.headers as Record<string, string | string[] | undefined>);
    reply.status(response.statusCode).headers(safeHeaders);
    return reply.send(response.body);
  }

  // ── GET route: HTTP proxy + WebSocket proxy on the same path ─────────────────
  // @fastify/websocket v11 supports co-location of HTTP and WS handlers via a
  // single app.route() call with both `handler` (for plain HTTP) and `wsHandler`
  // (for WebSocket upgrades). Two separate registrations for the same GET path
  // would cause a Fastify duplicate route error.
  app.route<ProxyParams>({
    method: 'GET',
    url: '/proxy/:id/*',
    handler: httpProxy,
    wsHandler: (socket: WebSocket, request) => {
      const { id } = request.params;
      const instance = app.monitor.getStatus()?.instances.find((i) => i.id === id);
      if (!instance) {
        socket.close(1011, 'Instance not found');
        return;
      }

      const subPath = request.params['*'] ? `/${request.params['*']}` : '/';
      const upstreamUrl = `ws://localhost:${instance.port}${subPath}`;

      // Spoof the Origin header so the gateway's allowedOrigins check passes
      const upstream = new WebSocket(upstreamUrl, {
        headers: { origin: `http://localhost:${instance.port}` },
      });

      socket.on('message', (msg) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(msg);
      });
      upstream.on('message', (msg) => {
        try { socket.send(msg as string); } catch { /* socket may have closed */ }
      });

      socket.on('close', () => upstream.close());
      upstream.on('close', () => { try { socket.close(); } catch { /* already closed */ } });

      upstream.on('error', () => {
        try { socket.close(1011, 'Upstream WS error'); } catch { /* already closed */ }
      });
    },
  });

  // ── Non-GET HTTP methods ────────────────────────────────────────────────────
  app.route<ProxyParams>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    url: '/proxy/:id/*',
    handler: httpProxy,
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run tests/routes/proxy.test.ts
```
Expected: 6 tests pass (5 `stripFrameHeaders` unit tests + 1 route test).

- [ ] **Step 7: Run full server test suite to check no regressions**

```bash
cd packages/server && npx vitest run
```
Expected: All 35 tests pass (29 existing + 6 new: 5 `stripFrameHeaders` unit tests + 1 route test).

- [ ] **Step 8: Commit**

```bash
git add packages/server/package.json package-lock.json \
        packages/server/src/routes/proxy.ts \
        packages/server/tests/routes/proxy.test.ts
git commit -m "feat(server): add undici+ws deps and reverse proxy route for control UI embedding"
```

---

## Task 2: Wire proxy route into server

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Import and register proxyRoutes in index.ts**

Add the import after the existing route imports:
```typescript
import { proxyRoutes } from './routes/proxy.js';
```

Register it after `logRoutes` (order matters — proxy catch-all must come after specific routes):
```typescript
await app.register(logRoutes);
await app.register(proxyRoutes);  // ← add this line
```

- [ ] **Step 2: Update the NotFoundHandler to exclude `/proxy/`**

The existing handler is:
```typescript
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
    return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
  }
  return reply.sendFile('index.html');
});
```

Update the condition to also exclude `/proxy/`:
```typescript
app.setNotFoundHandler((request, reply) => {
  if (
    request.url.startsWith('/api/') ||
    request.url.startsWith('/ws/') ||
    request.url.startsWith('/proxy/')
  ) {
    return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
  }
  return reply.sendFile('index.html');
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/server && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): register proxy routes and exclude /proxy/ from SPA fallback"
```

---

## Task 3: Vite dev proxy config

**Files:**
- Modify: `packages/web/vite.config.ts`

The Vite dev server runs on `:5173` and proxies `/api` and `/ws` to the server on `:3001`. The new `/proxy/:id/*` routes — both HTTP and WebSocket — also need to be proxied in dev mode.

- [ ] **Step 1: Add `/proxy` entries to Vite proxy config**

Current `vite.config.ts`:
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3001',
    '/ws': { target: 'ws://localhost:3001', ws: true },
  },
},
```

Updated:
```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3001',
    '/ws': { target: 'ws://localhost:3001', ws: true },
    '/proxy': {
      target: 'http://localhost:3001',
      ws: true,           // also proxy WebSocket upgrades on /proxy paths
      changeOrigin: false,
    },
  },
},
```

- [ ] **Step 2: Verify Vite still starts without errors**

```bash
cd packages/web && npx vite --port 5173
```
Expected: Dev server starts on `:5173` with no config errors. (Ctrl-C to stop.)

- [ ] **Step 3: Commit**

```bash
git add packages/web/vite.config.ts
git commit -m "feat(web): proxy /proxy/* to backend in Vite dev server"
```

---

## Task 4: ControlUiTab component

**Files:**
- Create: `packages/web/src/components/instances/ControlUiTab.tsx`

The tab renders a full-height `<iframe>` pointing at `/proxy/<instanceId>/`. Because the proxy strips the frame-blocking headers, the browser allows the frame. A "Open in new tab" button is provided as a fallback for cases where the user prefers the standalone UI (e.g., if a feature needs the full window).

A loading overlay hides the blank iframe flicker while the control UI JS bundle loads.

- [ ] **Step 1: Create ControlUiTab.tsx**

```tsx
// packages/web/src/components/instances/ControlUiTab.tsx
import { useState } from 'react';

interface Props {
  instanceId: string;
  port: number;
}

export function ControlUiTab({ instanceId, port }: Props) {
  const [loaded, setLoaded] = useState(false);

  const proxyUrl = `/proxy/${instanceId}/`;
  const directUrl = `http://localhost:${port}/`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border, #e2e8f0)',
          fontSize: '13px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--muted-foreground, #64748b)' }}>
          OpenClaw Control UI — {instanceId}
        </span>
        <a
          href={directUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--primary, #3b82f6)', textDecoration: 'none' }}
        >
          Open in new tab ↗
        </a>
      </div>

      {/* Loading overlay */}
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background, #fff)',
            color: 'var(--muted-foreground, #64748b)',
            fontSize: '14px',
            zIndex: 1,
          }}
        >
          Loading control UI…
        </div>
      )}

      {/* The iframe */}
      <iframe
        src={proxyUrl}
        title={`OpenClaw Control UI — ${instanceId}`}
        onLoad={() => setLoaded(true)}
        style={{
          flex: 1,
          border: 'none',
          width: '100%',
          background: 'var(--background, #fff)',
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
```

**Note on `sandbox`:**
- `allow-scripts` — the control UI JS must run
- `allow-same-origin` — allows the control UI to read/write localStorage (required for token auth)
- `allow-forms` — allows form submissions
- `allow-popups` + `allow-popups-to-escape-sandbox` — allows any "open in tab" links inside the UI

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/instances/ControlUiTab.tsx
git commit -m "feat(web): add ControlUiTab iframe component for embedded OpenClaw UI"
```

---

## Task 5: Wire tab into InstancePanel and store

**Files:**
- Modify: `packages/web/src/store.ts`
- Modify: `packages/web/src/components/instances/InstancePanel.tsx`

- [ ] **Step 1: Add 'controlui' to the Tab type in store.ts**

Current:
```typescript
type Tab = 'overview' | 'logs' | 'config' | 'metrics';
```

Updated:
```typescript
type Tab = 'overview' | 'logs' | 'config' | 'metrics' | 'controlui';
```

No other changes needed in store.ts — `selectInstance` already resets to `'overview'`, and `setTab` accepts the union type.

- [ ] **Step 2: Add lazy import + tab button + tab render in InstancePanel.tsx**

Current top of `InstancePanel.tsx`:
```typescript
const LogsTab = lazy(async () => ({ default: (await import('./LogsTab')).LogsTab }));
const ConfigTab = lazy(async () => ({ default: (await import('./ConfigTab')).ConfigTab }));
const MetricsTab = lazy(async () => ({ default: (await import('./MetricsTab')).MetricsTab }));

const tabs = ['overview', 'logs', 'config', 'metrics'] as const;
```

Updated — add `ControlUiTab` lazy import and update tabs array:
```typescript
const LogsTab = lazy(async () => ({ default: (await import('./LogsTab')).LogsTab }));
const ConfigTab = lazy(async () => ({ default: (await import('./ConfigTab')).ConfigTab }));
const MetricsTab = lazy(async () => ({ default: (await import('./MetricsTab')).MetricsTab }));
const ControlUiTab = lazy(async () => ({ default: (await import('./ControlUiTab')).ControlUiTab }));

const tabs = ['overview', 'logs', 'config', 'metrics', 'controlui'] as const;
```

The tab button label: add a special case so the button reads "control ui" instead of "controlui":

Current tab button render:
```tsx
<button
  key={tab}
  className={`tab-button ${activeTab === tab ? 'active' : ''}`}
  onClick={() => setTab(tab)}
>
  {tab}
</button>
```

Updated (capitalises the display name):
```tsx
<button
  key={tab}
  className={`tab-button ${activeTab === tab ? 'active' : ''}`}
  onClick={() => setTab(tab)}
>
  {tab === 'controlui' ? 'control ui' : tab}
</button>
```

In the Suspense section, add the ControlUiTab render. The tab needs the `instance.port` prop, which is already available:

Current Suspense block:
```tsx
{activeTab === 'logs' ? <LogsTab instanceId={instanceId} /> : null}
{activeTab === 'config' ? <ConfigTab instanceId={instanceId} /> : null}
{activeTab === 'metrics' ? <MetricsTab instance={instance} /> : null}
```

Updated — add ControlUiTab:
```tsx
{activeTab === 'logs' ? <LogsTab instanceId={instanceId} /> : null}
{activeTab === 'config' ? <ConfigTab instanceId={instanceId} /> : null}
{activeTab === 'metrics' ? <MetricsTab instance={instance} /> : null}
{activeTab === 'controlui' ? <ControlUiTab instanceId={instanceId} port={instance.port} /> : null}
```

- [ ] **Step 3: Check TypeScript compiles in web package**

```bash
cd packages/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Build production**

```bash
cd /path/to/claw-fleet-manager && npm run build
```
Expected: Server and web both build successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/store.ts \
        packages/web/src/components/instances/InstancePanel.tsx
git commit -m "feat(web): add 'control ui' tab to instance panel with proxied iframe"
```

---

## Task 6: Smoke test end-to-end

No code changes — manual validation with 3 live OpenClaw instances.

**Prerequisites:**
- 3 OpenClaw instances running (`docker ps` shows `openclaw-1`, `openclaw-2`, `openclaw-3` all healthy)
- `packages/server/server.config.json` exists with correct `fleetDir`
- Repo built (`npm run build`)

- [ ] **Step 1: Start the fleet manager**

```bash
node packages/server/dist/index.js
```
Expected log: `Claw Fleet Manager running at http://0.0.0.0:3001`

- [ ] **Step 2: Verify HTTP proxy strips frame headers**

```bash
curl -sI -u admin:changeme http://localhost:3001/proxy/openclaw-1/ \
  | grep -iE "x-frame-options|content-security-policy"
```
Expected:
- `X-Frame-Options` line: **absent**
- `Content-Security-Policy` line: present, containing `frame-ancestors 'self'` (not `frame-ancestors 'none'`)

- [ ] **Step 3: Verify control UI HTML is served through proxy**

```bash
curl -s -u admin:changeme http://localhost:3001/proxy/openclaw-1/ | grep -i "openclaw"
```
Expected: HTML containing `<title>OpenClaw Control</title>` (or similar).

- [ ] **Step 4: Open UI in browser and verify tab**

Open `http://localhost:3001` in a browser. Log in with Basic Auth (`admin` / `changeme`).

1. Click any instance in the sidebar (e.g., `openclaw-1`)
2. Click the **"control ui"** tab
3. Expected: The OpenClaw Control UI loads inside the iframe within a few seconds
4. Interact with the control UI (log in, navigate) — verify it functions correctly
5. Click "Open in new tab ↗" — verify it opens `http://localhost:18789/` in a new tab

- [ ] **Step 5: Verify different instances show different UIs**

1. Click `openclaw-2` in the sidebar, then "control ui" tab
2. Expected: A different control UI loads (different token/config than openclaw-1)

- [ ] **Step 6: Stop server**

```bash
# Ctrl-C or kill the process
```

- [ ] **Step 7: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: address control UI proxy smoke test findings"
```
(Skip if no fixups needed.)
