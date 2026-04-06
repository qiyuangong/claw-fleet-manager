# Remove Deployment Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `deploymentMode` config field and `FleetStatus.mode` field — the server always runs in hybrid mode and these fields carry no branching logic.

**Architecture:** Pure dead-code removal across server types, schemas, routes, services, and tests — no new logic added. Web type mirrors the server change. Three tasks: (1) types + schema, (2) services + routes, (3) tests.

**Tech Stack:** TypeScript, Fastify, Vitest, React (web types only)

---

## File Structure

**Modified (server):**
- `packages/server/src/types.ts` — Remove `deploymentMode?` from `ServerConfig`; remove `mode` from `FleetStatus`
- `packages/server/src/config.ts` — Remove `deploymentMode` from zod schema
- `packages/server/src/schemas.ts` — Remove `mode` from `fleetStatusSchema`
- `packages/server/src/fastify.d.ts` — Remove `deploymentMode` from `FastifyInstance`
- `packages/server/src/index.ts` — Remove `app.decorate('deploymentMode', 'hybrid')`
- `packages/server/src/routes/fleet.ts` — Remove `mode: app.deploymentMode` from fallback object
- `packages/server/src/services/docker-backend.ts` — Remove `mode: 'docker'` from two `FleetStatus` literals
- `packages/server/src/services/profile-backend.ts` — Remove `mode: 'profiles'` from `FleetStatus` literal
- `packages/server/src/services/hybrid-backend.ts` — Remove `mode: 'hybrid'` from `mergeStatuses()` return

**Modified (web):**
- `packages/web/src/types.ts` — Remove `mode` from `FleetStatus`

**Modified (tests):**
- `packages/server/tests/routes/fleet.test.ts`
- `packages/server/tests/routes/instances.test.ts`
- `packages/server/tests/routes/documentation.test.ts`
- `packages/server/tests/routes/plugins.test.ts`
- `packages/server/tests/routes/profiles.test.ts`
- `packages/server/tests/routes/logs.test.ts`
- `packages/server/tests/routes/config.test.ts`
- `packages/server/tests/services/hybrid-backend.test.ts`
- `packages/server/tests/services/docker-backend.test.ts`
- `packages/server/tests/services/profile-backend.test.ts`

---

### Task 1: Remove `deploymentMode` and `FleetStatus.mode` from types and schemas

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/schemas.ts`
- Modify: `packages/server/src/fastify.d.ts`
- Modify: `packages/web/src/types.ts`

- [ ] **Step 1: Update `packages/server/src/types.ts`**

Remove `deploymentMode?` from `ServerConfig` and remove `mode` from `FleetStatus`:

```ts
// packages/server/src/types.ts
export interface TailscaleConfig {
  hostname: string;
  portMap: Map<number, number>;
}

export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  baseDir?: string;
  tailscale?: { hostname: string };
  tls?: { cert: string; key: string };
  profiles?: ProfilesConfig;
}

export type InstanceMode = 'docker' | 'profile';

export interface ProfilesConfig {
  openclawBinary: string;
  basePort: number;
  portStep: number;
  stateBaseDir: string;
  configBaseDir: string;
  autoRestart: boolean;
  stopTimeoutMs: number;
}

export interface FleetInstance {
  id: string;
  mode: InstanceMode;
  index?: number;          // present in docker mode (1-based), absent in profile mode
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  profile?: string;        // profile mode only: profile name
  pid?: number;            // profile mode only: OS process ID
}

export interface FleetStatus {
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}

export interface User {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}

export type PublicUser = Omit<User, 'passwordHash'>;
```

- [ ] **Step 2: Update `packages/server/src/config.ts`**

Remove the `deploymentMode` line from the zod schema:

```ts
const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
  baseDir: z.string().default(join(homedir(), 'openclaw-instances')),
  tailscale: z.object({ hostname: z.string().min(1) }).optional(),
  tls: z.object({
    cert: z.string().min(1),
    key: z.string().min(1),
  }).optional(),
  profiles: profilesSchema.optional(),
});
```

- [ ] **Step 3: Update `packages/server/src/schemas.ts`**

Remove `mode` from `fleetStatusSchema` properties and required array:

```ts
export const fleetStatusSchema = {
  type: 'object',
  properties: {
    instances: { type: 'array', items: fleetInstanceSchema },
    totalRunning: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: ['instances', 'totalRunning', 'updatedAt'],
} as const;
```

- [ ] **Step 4: Update `packages/server/src/fastify.d.ts`**

Remove `deploymentMode` from `FastifyInstance`:

```ts
import type { DeploymentBackend } from './services/backend.js';
import type { FleetConfigService } from './services/fleet-config.js';
import type { UserService } from './services/user.js';
import type { User } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    backend: DeploymentBackend;
    fleetConfig: FleetConfigService;
    fleetDir: string;
    userService: UserService;
  }
  interface FastifyRequest {
    user: User;
  }
}
```

- [ ] **Step 5: Update `packages/web/src/types.ts`**

Remove `mode` from `FleetStatus`:

```ts
// packages/web/src/types.ts
export interface FleetInstance {
  id: string;
  mode: 'docker' | 'profile';
  index?: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  profile?: string;
  pid?: number;
}

export interface FleetStatus {
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}

export interface PublicUser {
  username: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: errors only from service files that still reference `mode:` on `FleetStatus` objects (those are fixed in Task 2).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/config.ts packages/server/src/schemas.ts packages/server/src/fastify.d.ts packages/web/src/types.ts
git commit -m "refactor: remove deploymentMode config and FleetStatus.mode from types and schemas"
```

---

### Task 2: Remove `mode` from service and route implementations

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/src/services/profile-backend.ts`
- Modify: `packages/server/src/services/hybrid-backend.ts`

- [ ] **Step 1: Update `packages/server/src/index.ts`**

Remove the `app.decorate('deploymentMode', 'hybrid')` line (currently line 109):

```ts
// ── Decorators ───────────────────────────────────────────────────────────────
app.decorate('backend', backend as DeploymentBackend);
app.decorate('fleetConfig', fleetConfig);
app.decorate('fleetDir', config.fleetDir);
app.decorate('userService', userService);
```

- [ ] **Step 2: Update `packages/server/src/routes/fleet.ts`**

Replace the fallback object on line 36 — remove `mode: app.deploymentMode`:

Change:
```ts
const status = app.backend.getCachedStatus()
  ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
```

To:
```ts
const status = app.backend.getCachedStatus()
  ?? { instances: [], totalRunning: 0, updatedAt: Date.now() };
```

- [ ] **Step 3: Update `packages/server/src/services/docker-backend.ts`**

There are two `FleetStatus` objects constructed here. Remove `mode: 'docker'` from both.

First object (around line 83–100, the per-container mapping result that feeds into `instances`):
> Note: This is actually on `FleetInstance` objects, not `FleetStatus`. The `FleetStatus` with `mode: 'docker'` is at line 123. Find the two spots: line 85 is on a `FleetInstance` (`mode: 'docker'` on individual instances — **keep this**, it's `InstanceMode`) and line 124 is on `FleetStatus` — **remove this**.

To clarify: `mode: 'docker'` at line 85 is the `FleetInstance.mode` field — do NOT remove it (it tells the hybrid router which backend owns this instance). Only remove the `FleetStatus.mode` field.

Line 123–128 currently:
```ts
const status: FleetStatus = {
  mode: 'docker',
  instances,
  totalRunning: instances.filter((i) => i.status === 'running').length,
  updatedAt: Date.now(),
};
```

Change to:
```ts
const status: FleetStatus = {
  instances,
  totalRunning: instances.filter((i) => i.status === 'running').length,
  updatedAt: Date.now(),
};
```

- [ ] **Step 4: Update `packages/server/src/services/profile-backend.ts`**

Line 141–146 currently:
```ts
const status: FleetStatus = {
  mode: 'profiles',
  instances,
  totalRunning: instances.filter((i) => i.status === 'running').length,
  updatedAt: Date.now(),
};
```

Change to:
```ts
const status: FleetStatus = {
  instances,
  totalRunning: instances.filter((i) => i.status === 'running').length,
  updatedAt: Date.now(),
};
```

- [ ] **Step 5: Update `packages/server/src/services/hybrid-backend.ts`**

`mergeStatuses()` return at line 128–137 currently:
```ts
return {
  mode: 'hybrid',
  instances,
  totalRunning: instances.filter((instance) => instance.status === 'running').length,
  updatedAt: Math.max(dockerStatus?.updatedAt ?? 0, profileStatus?.updatedAt ?? 0),
};
```

Change to:
```ts
return {
  instances,
  totalRunning: instances.filter((instance) => instance.status === 'running').length,
  updatedAt: Math.max(dockerStatus?.updatedAt ?? 0, profileStatus?.updatedAt ?? 0),
};
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/routes/fleet.ts packages/server/src/services/docker-backend.ts packages/server/src/services/profile-backend.ts packages/server/src/services/hybrid-backend.ts
git commit -m "refactor: remove deploymentMode decorator and FleetStatus.mode from services and routes"
```

---

### Task 3: Update tests

**Files:**
- Modify: `packages/server/tests/routes/fleet.test.ts`
- Modify: `packages/server/tests/routes/instances.test.ts`
- Modify: `packages/server/tests/routes/documentation.test.ts`
- Modify: `packages/server/tests/routes/plugins.test.ts`
- Modify: `packages/server/tests/routes/profiles.test.ts`
- Modify: `packages/server/tests/routes/logs.test.ts`
- Modify: `packages/server/tests/routes/config.test.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`
- Modify: `packages/server/tests/services/profile-backend.test.ts`

- [ ] **Step 1: Update `packages/server/tests/routes/fleet.test.ts`**

**a)** Remove `mode: 'hybrid' as const` from the `mockStatus` object at the top of the file:

```ts
const mockStatus = {
  instances: [
    { id: 'openclaw-1', mode: 'docker' as const, index: 1, status: 'running', port: 18789, token: 'abc1***f456',
      uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
      health: 'healthy', image: 'openclaw:local' },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};
```

**b)** Remove `app.decorate('deploymentMode', 'hybrid')` from the first `beforeAll` block (around line 32).

**c)** Remove `app.decorate('deploymentMode', 'hybrid')` from the second `beforeAll` block (around line 183).

**d)** Update the test description and assertion for the mode check:

Change the test at line 43:
```ts
it('GET /api/fleet returns fleet status with mode', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fleet' });
  expect(res.statusCode).toBe(200);
  expect(res.json().mode).toBe('hybrid');
  expect(res.json().instances).toHaveLength(1);
  expect(res.json().totalRunning).toBe(1);
});
```

To:
```ts
it('GET /api/fleet returns fleet status', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fleet' });
  expect(res.statusCode).toBe(200);
  expect(res.json().instances).toHaveLength(1);
  expect(res.json().totalRunning).toBe(1);
});
```

- [ ] **Step 2: Update `packages/server/tests/routes/instances.test.ts`**

Remove `app.decorate('deploymentMode', 'hybrid')` from the `beforeAll` block. (The line appears once, near the other decorator calls.)

- [ ] **Step 3: Update `packages/server/tests/routes/documentation.test.ts`**

Remove `app.decorate('deploymentMode', 'hybrid')` from the `beforeAll` block.

- [ ] **Step 4: Update `packages/server/tests/routes/plugins.test.ts`**

Remove `app.decorate('deploymentMode', 'hybrid')` from the setup block.

- [ ] **Step 5: Update `packages/server/tests/routes/profiles.test.ts`**

Remove `app.decorate('deploymentMode', 'profiles')` from the `beforeAll` block.

- [ ] **Step 6: Update `packages/server/tests/routes/logs.test.ts`**

Remove `app.decorate('deploymentMode', 'docker')` from the setup block.

- [ ] **Step 7: Update `packages/server/tests/routes/config.test.ts`**

Remove `app.decorate('deploymentMode', 'hybrid')` from the `beforeAll` block.

- [ ] **Step 8: Update `packages/server/tests/services/hybrid-backend.test.ts`**

**a)** Remove `mode: 'docker'` from the `dockerBackend.getCachedStatus` mock return value in `beforeEach` (around line 77–82):

```ts
dockerBackend.getCachedStatus.mockReturnValue({
  instances: [dockerInstance],
  totalRunning: 1,
  updatedAt: 1000,
});
```

**b)** Remove `mode: 'profiles'` from the `profileBackend.getCachedStatus` mock return value in `beforeEach` (around line 83–88):

```ts
profileBackend.getCachedStatus.mockReturnValue({
  instances: [profileInstance],
  totalRunning: 1,
  updatedAt: 2000,
});
```

**c)** Remove `expect(status.mode).toBe('hybrid')` from the `'refresh merges docker and profile instances'` test (line 99).

**d)** Update the `'refresh falls back to cached profile status'` test (around line 134–155) — remove `mode: 'profiles'` from the two inline `FleetStatus` objects:

```ts
it('refresh falls back to cached profile status when docker refresh fails', async () => {
  dockerBackend.getCachedStatus.mockReturnValue(null);
  profileBackend.getCachedStatus.mockReturnValue({
    instances: [profileInstance],
    totalRunning: 1,
    updatedAt: 2000,
  });
  dockerBackend.refresh.mockRejectedValueOnce(new Error('docker unavailable'));
  profileBackend.refresh.mockResolvedValueOnce({
    instances: [profileInstance],
    totalRunning: 1,
    updatedAt: 3000,
  });

  const status = await backend.refresh();

  expect(status.instances).toEqual([profileInstance]);
  expect(status.updatedAt).toBe(3000);
});
```

- [ ] **Step 9: Update `packages/server/tests/services/docker-backend.test.ts`**

**a)** Remove `expect(status.mode).toBe('docker')` from the `'refresh() returns FleetStatus with mode=docker'` test (line 184). Update the test description too:

```ts
it('refresh() returns FleetStatus', async () => {
  mockDocker.listFleetContainers.mockResolvedValue([
    { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
  ]);
  const status = await backend.refresh();
  expect(status.instances).toHaveLength(1);
  expect(status.instances[0].id).toBe('openclaw-1');
  expect(status.instances[0].index).toBe(1);
});
```

**b)** Remove `expect(backend.getCachedStatus()?.mode).toBe('docker')` from the `'getCachedStatus() returns the last refresh result'` test (line 204):

```ts
it('getCachedStatus() returns the last refresh result', async () => {
  await backend.refresh();
  expect(backend.getCachedStatus()).not.toBeNull();
});
```

- [ ] **Step 10: Update `packages/server/tests/services/profile-backend.test.ts`**

Remove `expect(status?.mode).toBe('profiles')` from the `'returns mode=profiles'` test. Update test description:

```ts
describe('ProfileBackend — getCachedStatus', () => {
  it('returns non-null status after initialize', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const backend = makeBackend();
    await backend.initialize();
    const status = backend.getCachedStatus();
    expect(status).not.toBeNull();
  });
});
```

- [ ] **Step 11: Run all tests**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add packages/server/tests/routes/fleet.test.ts packages/server/tests/routes/instances.test.ts packages/server/tests/routes/documentation.test.ts packages/server/tests/routes/plugins.test.ts packages/server/tests/routes/profiles.test.ts packages/server/tests/routes/logs.test.ts packages/server/tests/routes/config.test.ts packages/server/tests/services/hybrid-backend.test.ts packages/server/tests/services/docker-backend.test.ts packages/server/tests/services/profile-backend.test.ts
git commit -m "test: remove deploymentMode decorator and FleetStatus.mode assertions from tests"
```
