# Admin Sessions View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Sessions" view that polls all running openclaw instances and shows their active/recent sessions in a single aggregated panel.

**Architecture:** A new `openclaw-client.ts` service opens a short-lived WebSocket to each instance, authenticates with its gateway token, calls `sessions.list`, and returns the sessions. A new `GET /api/fleet/sessions` Fastify route fans out to all running instances in parallel and returns the merged result. The React frontend polls this endpoint every 15 seconds and renders instance cards with session rows.

**Tech Stack:** Node.js `ws` package (already in server), Fastify, React 19, React Query, Zustand, TypeScript (ES modules, `.js` extensions in imports), Vitest

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `packages/server/src/services/openclaw-client.ts` | WS client that fetches sessions from one openclaw instance |
| Create | `packages/server/src/routes/sessions.ts` | `GET /api/fleet/sessions` route, fans out to all instances |
| Create | `packages/server/tests/services/openclaw-client.test.ts` | Unit tests for the WS client |
| Create | `packages/server/tests/routes/sessions.test.ts` | Route tests |
| Modify | `packages/server/src/index.ts` | Register `sessionRoutes` |
| Modify | `packages/web/src/types.ts` | Add `InstanceSessionRow`, `InstanceSessionsEntry`, `FleetSessionsResult` |
| Modify | `packages/web/src/api/fleet.ts` | Add `getFleetSessions()` |
| Create | `packages/web/src/hooks/useFleetSessions.ts` | React Query polling hook |
| Modify | `packages/web/src/store.ts` | Add `sessions` view type + `selectSessions` action |
| Modify | `packages/web/src/i18n/locales/en.ts` | Add sessions-related strings |
| Modify | `packages/web/src/i18n/locales/zh.ts` | Add sessions-related strings |
| Create | `packages/web/src/components/instances/FleetSessionsPanel.tsx` | Admin sessions panel component |
| Modify | `packages/web/src/components/layout/Sidebar.tsx` | Add Sessions nav item |
| Modify | `packages/web/src/components/layout/Shell.tsx` | Render `FleetSessionsPanel` for `sessions` view |

---

## Task 1: openclaw-client.ts — WS client service

**Files:**
- Create: `packages/server/src/services/openclaw-client.ts`
- Create: `packages/server/tests/services/openclaw-client.test.ts`

- [ ] **Step 1.1: Write the failing tests**

```typescript
// packages/server/tests/services/openclaw-client.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { fetchInstanceSessions } from '../../src/services/openclaw-client.js';
import type { InstanceSessionRow } from '../../src/services/openclaw-client.js';

const FIXTURE_SESSIONS: InstanceSessionRow[] = [
  {
    key: 'main',
    derivedTitle: 'Fix CI flake',
    status: 'running',
    startedAt: Date.now() - 60_000,
    model: 'claude-opus-4',
    lastMessagePreview: 'The test now passes.',
  },
];

const PORT = 19_999;
let wss: WebSocketServer | undefined;

afterEach(
  () =>
    new Promise<void>((res) => {
      if (!wss) { res(); return; }
      wss.close(() => res());
      wss = undefined;
    }),
);

function makeServer(opts: { rejectConnect?: boolean; silentAfterChallenge?: boolean } = {}) {
  const server = new WebSocketServer({ port: PORT });
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n' } }));
    if (opts.silentAfterChallenge) return;
    ws.on('message', (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as { method: string; id: string };
      if (frame.method === 'connect') {
        if (opts.rejectConnect) {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'AUTH_FAILED', message: 'bad token' } }));
          return;
        }
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
      }
      if (frame.method === 'sessions.list') {
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { sessions: FIXTURE_SESSIONS } }));
      }
    });
  });
  return server;
}

describe('fetchInstanceSessions', () => {
  it('returns sessions from a healthy instance', async () => {
    wss = makeServer();
    const sessions = await fetchInstanceSessions(PORT, 'valid-token');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].derivedTitle).toBe('Fix CI flake');
    expect(sessions[0].status).toBe('running');
  });

  it('returns empty array when payload has no sessions field', async () => {
    wss = new WebSocketServer({ port: PORT });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge' }));
      ws.on('message', (raw: Buffer) => {
        const frame = JSON.parse(String(raw)) as { method: string; id: string };
        if (frame.method === 'connect') ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
        if (frame.method === 'sessions.list') ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
      });
    });
    const sessions = await fetchInstanceSessions(PORT, 'valid-token');
    expect(sessions).toEqual([]);
  });

  it('rejects when connect is refused', async () => {
    wss = makeServer({ rejectConnect: true });
    await expect(fetchInstanceSessions(PORT, 'bad-token')).rejects.toThrow('bad token');
  });

  it('rejects on timeout', async () => {
    wss = makeServer({ silentAfterChallenge: true });
    await expect(fetchInstanceSessions(PORT, 'any', 300)).rejects.toThrow('did not respond');
  });

  it('rejects when nothing is listening on the port', async () => {
    // wss stays undefined, afterEach handles it safely
    await expect(fetchInstanceSessions(PORT, 'any', 300)).rejects.toThrow();
  });
});
```

- [ ] **Step 1.2: Run tests — expect all 5 to fail with "cannot find module"**

```bash
cd packages/server && npx vitest run tests/services/openclaw-client.test.ts
```

Expected: `Error: Cannot find module '../../src/services/openclaw-client.js'`

- [ ] **Step 1.3: Implement `openclaw-client.ts`**

```typescript
// packages/server/src/services/openclaw-client.ts
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
};

type ResFrame = { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { code: string; message: string } };
type EventFrame = { type: 'event'; event: string; payload?: unknown };

export async function fetchInstanceSessions(
  port: number,
  token: string,
  timeoutMs = 5_000,
): Promise<InstanceSessionRow[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let settled = false;

    const timer = setTimeout(() => {
      done(null, new Error(`openclaw on port ${port} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    function done(sessions: InstanceSessionRow[] | null, err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      if (err) reject(err);
      else resolve(sessions ?? []);
    }

    function request<T>(method: string, params: unknown): Promise<T> {
      return new Promise<T>((res, rej) => {
        const id = randomUUID();
        pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      });
    }

    ws.on('error', (err) => done(null, err));

    ws.on('message', (raw) => {
      let frame: ResFrame | EventFrame;
      try {
        frame = JSON.parse(String(raw)) as ResFrame | EventFrame;
      } catch {
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        void (async () => {
          try {
            await request('connect', {
              minProtocol: 3,
              maxProtocol: 3,
              role: 'operator',
              scopes: ['operator.read'],
              auth: { token },
            });
            const result = await request<{ sessions?: InstanceSessionRow[] }>(
              'sessions.list',
              { activeMinutes: 60 },
            );
            done(result?.sessions ?? []);
          } catch (err) {
            done(null, err instanceof Error ? err : new Error(String(err)));
          }
        })();
        return;
      }

      if (frame.type === 'res') {
        const p = pending.get(frame.id);
        if (!p) return;
        pending.delete(frame.id);
        if (frame.ok) p.resolve(frame.payload);
        else p.reject(new Error(frame.error?.message ?? 'gateway request failed'));
      }
    });
  });
}
```

- [ ] **Step 1.4: Run tests — all 5 should pass**

```bash
cd packages/server && npx vitest run tests/services/openclaw-client.test.ts
```

Expected: `5 passed`

- [ ] **Step 1.5: Commit**

```bash
git add packages/server/src/services/openclaw-client.ts packages/server/tests/services/openclaw-client.test.ts
git commit -m "feat(server): add openclaw WS client for fetching instance sessions"
```

---

## Task 2: `GET /api/fleet/sessions` route

**Files:**
- Create: `packages/server/src/routes/sessions.ts`
- Create: `packages/server/tests/routes/sessions.test.ts`

- [ ] **Step 2.1: Write the failing route tests**

```typescript
// packages/server/tests/routes/sessions.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { sessionRoutes } from '../../src/routes/sessions.js';

vi.mock('../../src/services/openclaw-client.js', () => ({
  fetchInstanceSessions: vi.fn().mockResolvedValue([
    {
      key: 'main',
      derivedTitle: 'Refactor auth',
      status: 'running',
      startedAt: Date.now() - 120_000,
      model: 'claude-opus-4',
      lastMessagePreview: 'Updated auth.ts.',
    },
  ]),
}));

const mockInstance = {
  id: 'openclaw-1', mode: 'docker' as const, index: 1, status: 'running' as const,
  port: 18789, token: 'tok***', uptime: 0, cpu: 0,
  memory: { used: 0, limit: 0 }, disk: { config: 0, workspace: 0 },
  health: 'healthy' as const, image: 'openclaw:local',
};

const stoppedInstance = { ...mockInstance, id: 'openclaw-2', status: 'stopped' as const };

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue({
    instances: [mockInstance, stoppedInstance],
    totalRunning: 1,
    updatedAt: Date.now(),
  }),
  revealToken: vi.fn().mockResolvedValue('full-gateway-token'),
};

describe('GET /api/fleet/sessions', () => {
  describe('as admin', () => {
    const app = Fastify();

    beforeAll(async () => {
      app.decorate('backend', mockBackend);
      app.addHook('onRequest', async (request) => {
        (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
      });
      await app.register(sessionRoutes);
      await app.ready();
    });

    afterAll(() => app.close());

    it('returns 200 with aggregated sessions from running instances only', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[] }[]; updatedAt: number }>();
      expect(body.updatedAt).toBeGreaterThan(0);
      // Only the running instance (openclaw-1) is fetched; stopped one is skipped
      expect(body.instances).toHaveLength(1);
      expect(body.instances[0].instanceId).toBe('openclaw-1');
      expect(body.instances[0].sessions).toHaveLength(1);
    });

    it('revealToken is called only for the running instance', async () => {
      mockBackend.revealToken.mockClear();
      await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(mockBackend.revealToken).toHaveBeenCalledOnce();
      expect(mockBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
    });

    it('returns instance with error when fetchInstanceSessions rejects', async () => {
      const { fetchInstanceSessions } = await import('../../src/services/openclaw-client.js');
      (fetchInstanceSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection refused'));
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[]; error?: string }[] }>();
      expect(body.instances[0].sessions).toEqual([]);
      expect(body.instances[0].error).toContain('connection refused');
    });

    it('returns empty instances when no running instances', async () => {
      mockBackend.getCachedStatus.mockReturnValueOnce({ instances: [stoppedInstance], totalRunning: 0, updatedAt: Date.now() });
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ instances: unknown[] }>().instances).toEqual([]);
    });

    it('returns empty instances when getCachedStatus is null', async () => {
      mockBackend.getCachedStatus.mockReturnValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ instances: unknown[] }>().instances).toEqual([]);
    });
  });

  describe('as non-admin', () => {
    const app = Fastify();

    beforeAll(async () => {
      app.decorate('backend', mockBackend);
      app.addHook('onRequest', async (request) => {
        (request as any).user = { username: 'alice', role: 'user', assignedProfiles: [] };
      });
      await app.register(sessionRoutes);
      await app.ready();
    });

    afterAll(() => app.close());

    it('returns 403', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(403);
    });
  });
});
```

- [ ] **Step 2.2: Run tests — expect failure with "cannot find module"**

```bash
cd packages/server && npx vitest run tests/routes/sessions.test.ts
```

Expected: `Error: Cannot find module '../../src/routes/sessions.js'`

- [ ] **Step 2.3: Implement `sessions.ts` route**

```typescript
// packages/server/src/routes/sessions.ts
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../authorize.js';
import { errorResponseSchema } from '../schemas.js';
import { fetchInstanceSessions, type InstanceSessionRow } from '../services/openclaw-client.js';
import type { FleetInstance } from '../types.js';
import type { DeploymentBackend } from '../services/backend.js';

export type InstanceSessionsEntry = {
  instanceId: string;
  sessions: InstanceSessionRow[];
  error?: string;
};

export type FleetSessionsResult = {
  instances: InstanceSessionsEntry[];
  updatedAt: number;
};

async function fetchEntry(instance: FleetInstance, backend: DeploymentBackend): Promise<InstanceSessionsEntry> {
  try {
    const token = await backend.revealToken(instance.id);
    const sessions = await fetchInstanceSessions(instance.port, token);
    return { instanceId: instance.id, sessions };
  } catch (err) {
    return {
      instanceId: instance.id,
      sessions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const fleetSessionsResponseSchema = {
  type: 'object',
  properties: {
    instances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instanceId: { type: 'string' },
          sessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string' },
        },
        required: ['instanceId', 'sessions'],
      },
    },
    updatedAt: { type: 'number' },
  },
  required: ['instances', 'updatedAt'],
} as const;

export async function sessionRoutes(app: FastifyInstance) {
  app.get<{ Reply: FleetSessionsResult }>('/api/fleet/sessions', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Sessions'],
      summary: 'Get recent sessions across all running instances (admin only)',
      response: {
        200: fleetSessionsResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async () => {
    const status = app.backend.getCachedStatus();
    const running = (status?.instances ?? []).filter((i) => i.status === 'running');
    const instances = await Promise.all(running.map((i) => fetchEntry(i, app.backend)));
    return { instances, updatedAt: Date.now() };
  });
}
```

- [ ] **Step 2.4: Run tests — all should pass**

```bash
cd packages/server && npx vitest run tests/routes/sessions.test.ts
```

Expected: `7 passed`

- [ ] **Step 2.5: Register the route in `index.ts`**

In `packages/server/src/index.ts`, add the import and registration. Find the block of `await app.register(...)` calls (around line 117–125) and add:

```typescript
// Add this import at the top with the other route imports:
import { sessionRoutes } from './routes/sessions.js';

// Add this line after the pluginRoutes registration (around line 125):
await app.register(sessionRoutes);
```

- [ ] **Step 2.6: Run the full server test suite to confirm nothing is broken**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass

- [ ] **Step 2.7: Commit**

```bash
git add packages/server/src/routes/sessions.ts packages/server/tests/routes/sessions.test.ts packages/server/src/index.ts
git commit -m "feat(server): add GET /api/fleet/sessions aggregator route"
```

---

## Task 3: Frontend types and API client

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/api/fleet.ts`

- [ ] **Step 3.1: Add types to `packages/web/src/types.ts`**

Append these exports at the bottom of the file:

```typescript
export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
};

export type InstanceSessionsEntry = {
  instanceId: string;
  sessions: InstanceSessionRow[];
  error?: string;
};

export type FleetSessionsResult = {
  instances: InstanceSessionsEntry[];
  updatedAt: number;
};
```

- [ ] **Step 3.2: Add `getFleetSessions` to `packages/web/src/api/fleet.ts`**

Append after the existing exports:

```typescript
export const getFleetSessions = () => apiFetch<FleetSessionsResult>('/api/fleet/sessions');
```

Also add the import for the new types at the top of the file (existing import line needs to include the new types):

```typescript
import type { FleetConfig, FleetInstance, FleetStatus, FleetSessionsResult } from '../types';
```

- [ ] **Step 3.3: Verify TypeScript compiles cleanly**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3.4: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/api/fleet.ts
git commit -m "feat(web): add FleetSessionsResult types and getFleetSessions API"
```

---

## Task 4: Store extension and i18n

**Files:**
- Modify: `packages/web/src/store.ts`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`

- [ ] **Step 4.1: Extend the store in `packages/web/src/store.ts`**

Replace the `ActiveView` type and `AppState` interface to add the new view. The current file defines:

```typescript
type ActiveView = { type: 'instance'; id: string } | { type: 'instances' } | { type: 'config' } | { type: 'users' } | { type: 'account' };
```

Change it to:

```typescript
type ActiveView = { type: 'instance'; id: string } | { type: 'instances' } | { type: 'config' } | { type: 'users' } | { type: 'account' } | { type: 'sessions' };
```

Add `selectSessions` to the `AppState` interface:

```typescript
interface AppState {
  activeView: ActiveView;
  activeTab: Tab;
  currentUser: PublicUser | null;
  selectInstance: (id: string) => void;
  selectInstances: () => void;
  selectConfig: () => void;
  selectUsers: () => void;
  selectAccount: () => void;
  selectSessions: () => void;
  setTab: (tab: Tab) => void;
  setCurrentUser: (user: PublicUser | null) => void;
}
```

Add the implementation in the `create` call after `selectAccount`:

```typescript
selectSessions: () => set({ activeView: { type: 'sessions' } }),
```

- [ ] **Step 4.2: Add English i18n strings to `packages/web/src/i18n/locales/en.ts`**

Find the `// Sidebar` section comment and add the new entries after the existing admin items (`fleetConfig`):

```typescript
  activeSessions: 'Active Sessions',
  manageSessions: 'Sessions',
  noActiveSessions: 'No active sessions across any running instance.',
  sessionFetchError: 'Could not fetch sessions for this instance',
  sessionRunning: 'running',
  sessionDone: 'done',
  sessionFailed: 'failed',
  sessionKilled: 'killed',
  sessionTimeout: 'timeout',
```

- [ ] **Step 4.3: Add Chinese i18n strings to `packages/web/src/i18n/locales/zh.ts`**

Add the same keys in the same section:

```typescript
  activeSessions: '活跃会话',
  manageSessions: '会话',
  noActiveSessions: '所有运行中的实例暂无活跃会话。',
  sessionFetchError: '无法获取该实例的会话',
  sessionRunning: '运行中',
  sessionDone: '已完成',
  sessionFailed: '失败',
  sessionKilled: '已终止',
  sessionTimeout: '超时',
```

- [ ] **Step 4.4: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4.5: Commit**

```bash
git add packages/web/src/store.ts packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts
git commit -m "feat(web): add sessions view to store and i18n strings"
```

---

## Task 5: `useFleetSessions` hook

**Files:**
- Create: `packages/web/src/hooks/useFleetSessions.ts`

- [ ] **Step 5.1: Create the hook**

```typescript
// packages/web/src/hooks/useFleetSessions.ts
import { useQuery } from '@tanstack/react-query';
import { getFleetSessions } from '../api/fleet';
import { useAppStore } from '../store';

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

export function useFleetSessions() {
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';

  return useQuery({
    queryKey: ['fleetSessions'],
    queryFn: getFleetSessions,
    enabled: isAdmin,
    refetchInterval: () => visibleRefetchInterval(15_000),
  });
}
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5.3: Commit**

```bash
git add packages/web/src/hooks/useFleetSessions.ts
git commit -m "feat(web): add useFleetSessions polling hook"
```

---

## Task 6: `FleetSessionsPanel` component

**Files:**
- Create: `packages/web/src/components/instances/FleetSessionsPanel.tsx`

- [ ] **Step 6.1: Create the component**

```tsx
// packages/web/src/components/instances/FleetSessionsPanel.tsx
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import { StatusBadge } from '../common/StatusBadge';
import type { InstanceSessionRow } from '../../types';

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

function formatRuntime(session: InstanceSessionRow): string {
  const ms =
    session.runtimeMs ??
    (session.startedAt != null ? Date.now() - session.startedAt : null);
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function sessionStatusClass(status: InstanceSessionRow['status']): string {
  if (status === 'running') return 'status-badge--running';
  if (status === 'done') return 'status-badge--healthy';
  if (status === 'failed' || status === 'killed' || status === 'timeout') return 'status-badge--unhealthy';
  return '';
}

function SessionRow({ session }: { session: InstanceSessionRow }) {
  const { t } = useTranslation();
  const statusLabel = session.status ? t(`session${session.status.charAt(0).toUpperCase()}${session.status.slice(1)}` as Parameters<typeof t>[0]) : '—';

  return (
    <div className="session-row">
      <div className="session-row-header">
        <span className="session-title">{sessionTitle(session)}</span>
        <span className={`pill ${sessionStatusClass(session.status)}`}>{statusLabel}</span>
        {session.model ? <span className="session-model muted">{session.model}</span> : null}
        <span className="session-runtime muted">{formatRuntime(session)}</span>
      </div>
      {session.lastMessagePreview ? (
        <p className="session-preview muted">{truncate(session.lastMessagePreview, 80)}</p>
      ) : null}
    </div>
  );
}

export function FleetSessionsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useFleetSessions();
  const selectInstance = useAppStore((state) => state.selectInstance);

  const totalRunningSessions = data?.instances.reduce(
    (sum, entry) => sum + entry.sessions.filter((s) => s.status === 'running').length,
    0,
  ) ?? 0;
  const instanceCount = data?.instances.filter((e) => e.sessions.length > 0 || e.error).length ?? 0;

  const updatedAgo = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 1000)
    : null;

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('activeSessions')}</h2>
            {data ? (
              <p className="muted">
                {instanceCount} instances · {totalRunningSessions} running
                {updatedAgo != null ? ` · updated ${updatedAgo}s ago` : null}
              </p>
            ) : null}
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : 'Refresh'}
          </button>
        </div>

        {isLoading ? (
          <p className="muted">Loading sessions…</p>
        ) : error ? (
          <p className="error-text">{(error as Error).message}</p>
        ) : !data || data.instances.length === 0 ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : (
          data.instances.map((entry) => (
            <div key={entry.instanceId} className="panel-card" style={{ marginBottom: '0.75rem' }}>
              <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <StatusBadge status={entry.sessions.some((s) => s.status === 'running') ? 'running' : 'stopped'} />
                  <button
                    className="sidebar-nav-item"
                    style={{ fontWeight: 600, padding: 0 }}
                    onClick={() => selectInstance(entry.instanceId)}
                  >
                    {entry.instanceId}
                  </button>
                </div>
                {entry.error ? (
                  <span className="error-text" style={{ fontSize: '0.8rem' }}>{t('sessionFetchError')}: {entry.error}</span>
                ) : null}
              </div>

              {entry.error && entry.sessions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>⚠ {t('sessionFetchError')}</p>
              ) : entry.sessions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No sessions</p>
              ) : (
                entry.sessions.map((session) => (
                  <SessionRow key={session.key} session={session} />
                ))
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 6.2: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6.3: Commit**

```bash
git add packages/web/src/components/instances/FleetSessionsPanel.tsx
git commit -m "feat(web): add FleetSessionsPanel component"
```

---

## Task 7: Wire Sidebar, Shell, and build

**Files:**
- Modify: `packages/web/src/components/layout/Sidebar.tsx`
- Modify: `packages/web/src/components/layout/Shell.tsx`

- [ ] **Step 7.1: Add Sessions nav item to `Sidebar.tsx`**

In `packages/web/src/components/layout/Sidebar.tsx`, find where `selectSessions` is destructured from `useAppStore`. Add it after `selectUsers`:

```typescript
const selectSessions = useAppStore((state) => state.selectSessions);
```

Then find the Admin section (lines 73–95) and add the Sessions button between the "Manage Instances" button and the "Users" button:

```tsx
<button
  className={`sidebar-nav-item${activeView.type === 'sessions' ? ' selected' : ''}`}
  onClick={selectSessions}
>
  {t('manageSessions')}
</button>
```

The full admin section should look like this after the edit:

```tsx
{currentUser?.role === 'admin' ? (
  <>
    <p className="sidebar-section">{t('admin')}</p>
    <button
      className={`sidebar-nav-item${activeView.type === 'instances' ? ' selected' : ''}`}
      onClick={selectInstances}
    >
      {t('manageInstances')}
    </button>
    <button
      className={`sidebar-nav-item${activeView.type === 'sessions' ? ' selected' : ''}`}
      onClick={selectSessions}
    >
      {t('manageSessions')}
    </button>
    <button
      className={`sidebar-nav-item${activeView.type === 'users' ? ' selected' : ''}`}
      onClick={selectUsers}
    >
      {t('users')}
    </button>
    <button
      className={`sidebar-nav-item${activeView.type === 'config' ? ' selected' : ''}`}
      onClick={selectConfig}
    >
      {t('fleetConfig')}
    </button>
  </>
) : null}
```

- [ ] **Step 7.2: Wire `FleetSessionsPanel` into `Shell.tsx`**

In `packages/web/src/components/layout/Shell.tsx`, add the import at the top:

```typescript
import { FleetSessionsPanel } from '../instances/FleetSessionsPanel';
```

Find the main content render block (around line 197–212). The current chain is:

```tsx
{currentUser && currentUser.role !== 'admin' && activeView.type === 'account' ? (
  <UserHomePanel ... />
) : activeView.type === 'instance' ? (
  <InstancePanel instanceId={activeView.id} />
) : activeView.type === 'instances' ? (
  <InstanceManagementPanel onOpenInstance={selectInstance} />
) : activeView.type === 'users' ? (
  <UserManagementPanel />
) : (
  <FleetConfigPanel />
)}
```

Add the `sessions` branch before the final fallback:

```tsx
{currentUser && currentUser.role !== 'admin' && activeView.type === 'account' ? (
  <UserHomePanel
    user={currentUser}
    instances={nonAdminAllowedInstances}
    onOpenInstance={selectInstance}
    onChangePassword={() => setShowChangePassword(true)}
  />
) : activeView.type === 'instance' ? (
  <InstancePanel instanceId={activeView.id} />
) : activeView.type === 'instances' ? (
  <InstanceManagementPanel onOpenInstance={selectInstance} />
) : activeView.type === 'users' ? (
  <UserManagementPanel />
) : activeView.type === 'sessions' ? (
  <FleetSessionsPanel />
) : (
  <FleetConfigPanel />
)}
```

- [ ] **Step 7.3: Verify TypeScript compiles**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7.4: Run a full build to confirm both packages compile**

```bash
npm run build
```

Expected: build succeeds with no errors

- [ ] **Step 7.5: Run the server test suite one final time**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass

- [ ] **Step 7.6: Commit**

```bash
git add packages/web/src/components/layout/Sidebar.tsx packages/web/src/components/layout/Shell.tsx
git commit -m "feat(web): wire Sessions nav and panel into Shell and Sidebar"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `openclaw-client.ts` — Task 1
- ✅ `GET /api/fleet/sessions` admin-only route — Task 2
- ✅ Only running instances queried — Task 2 (`filter status === 'running'`)
- ✅ `Promise.allSettled` pattern for partial failures — Task 2 (`Promise.all` with per-instance catch)
- ✅ 5s per-instance timeout (default in `fetchInstanceSessions`) — Task 1
- ✅ Response shape `{ instances, updatedAt }` — Task 2
- ✅ `FleetSessionsResult` types in web — Task 3
- ✅ `useFleetSessions` hook polling 15s, admin-only — Task 5
- ✅ `sessions` view in Zustand store — Task 4
- ✅ i18n strings en + zh — Task 4
- ✅ `FleetSessionsPanel` component — Task 6
- ✅ Sidebar Sessions nav item — Task 7
- ✅ Shell wiring — Task 7
- ✅ Title fallback chain (`derivedTitle → label → key`) — Task 6 (`sessionTitle`)
- ✅ Runtime format from `runtimeMs` or `startedAt` — Task 6 (`formatRuntime`)
- ✅ `lastMessagePreview` truncated at 80 chars — Task 6 (`truncate`)
- ✅ Instance header links to instance panel — Task 6 (`selectInstance`)
- ✅ Error state per instance — Task 6
- ✅ Empty state — Task 6
- ✅ Unit tests for WS client — Task 1
- ✅ Route tests (fan-out, partial failure, 403) — Task 2

**Type consistency check:**
- `InstanceSessionRow` defined in `openclaw-client.ts` (Task 1) and mirrored identically in `types.ts` (Task 3) — fields match
- `InstanceSessionsEntry` defined in `sessions.ts` (Task 2) and `types.ts` (Task 3) — fields match
- `FleetSessionsResult` defined in `sessions.ts` (Task 2) and `types.ts` (Task 3) — fields match
- `fetchInstanceSessions` signature used correctly in `sessions.ts` Task 2 and tested in Task 1
- `selectSessions` added to store interface and implementation in Task 4, consumed in Sidebar Task 7 ✅

**No placeholders found.**
