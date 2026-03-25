# Multi-Profile Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile-based deployment as a first-class alternative to Docker, where openclaw instances run directly on the host using `openclaw --profile <name> gateway`, managed through the same fleet UI.

**Architecture:** Introduce a `DeploymentBackend` interface implemented by both `DockerBackend` (wrapping existing Docker/Monitor/Compose logic) and `ProfileBackend` (managing host processes). Routes are updated to call `app.backend.*` instead of concrete services. Mode is set in `server.config.json` and cannot change at runtime.

**Tech Stack:** Node.js 20, TypeScript (ES modules), Fastify 5, Vitest, React 19 + React Query + Zustand

---

## File Map

**New server files:**
- `packages/server/src/services/backend.ts` — `DeploymentBackend` interface, `LogHandle`, `CreateInstanceOpts`
- `packages/server/src/services/dir-utils.ts` — shared `getDirectorySize` utility extracted from MonitorService
- `packages/server/src/services/docker-backend.ts` — `DockerBackend` class
- `packages/server/src/services/profile-backend.ts` — `ProfileBackend` class
- `packages/server/src/routes/profiles.ts` — profile CRUD routes (profile mode only)
- `packages/server/tests/services/docker-backend.test.ts`
- `packages/server/tests/services/profile-backend.test.ts`
- `packages/server/tests/routes/profiles.test.ts`

**Modified server files:**
- `packages/server/src/types.ts` — add `mode` to `FleetStatus`, `index?`/`profile?` to `FleetInstance`, add `ProfilesConfig`, update `ServerConfig`
- `packages/server/src/validate.ts` — dual-mode `validateInstanceId`
- `packages/server/src/fastify.d.ts` — add `backend`, `deploymentMode`; keep `fleetConfig`, `fleetDir`, `proxyAuth`; remove `monitor`, `docker`, `composeGenerator`, `tailscale`, `tailscaleHostname`
- `packages/server/src/config.ts` — extend Zod schema for `deploymentMode` + `ProfilesConfig`
- `packages/server/src/index.ts` — backend factory, updated decorators, startup flow
- `packages/server/src/routes/fleet.ts` — delegate to `app.backend`
- `packages/server/src/routes/instances.ts` — delegate to `app.backend`
- `packages/server/src/routes/config.ts` — delegate to `app.backend`
- `packages/server/src/routes/logs.ts` — delegate to `app.backend`
- `packages/server/tests/routes/fleet.test.ts` — mock `backend` instead of `monitor`/`docker`/etc.
- `packages/server/tests/routes/instances.test.ts` — mock `backend`
- `packages/server/tests/routes/config.test.ts` — mock `backend`
- `packages/server/tests/routes/logs.test.ts` — mock `backend`
- `packages/server/server.config.example.json` — add profiles example

**New web files:**
- `packages/web/src/components/instances/AddProfileDialog.tsx`

**Modified web files:**
- `packages/web/src/types.ts` — add `mode`, `profile?`, make `index` optional
- `packages/web/src/api/fleet.ts` — add `createProfile`, `deleteProfile`
- `packages/web/src/components/layout/Sidebar.tsx` — Add Profile button in profile mode
- `packages/web/src/components/instances/InstancePanel.tsx` — show `profile` name
- `packages/web/src/components/instances/OverviewTab.tsx` — show profile/PID info

---

## Task 1: Update Core Type Definitions

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/web/src/types.ts`

- [ ] **Step 1: Update server `types.ts`**

Replace the current contents:

```typescript
// packages/server/src/types.ts
export interface TailscaleConfig {
  hostname: string;
  portMap: Map<number, number>;
}

export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  tailscale?: { hostname: string };
  tls?: { cert: string; key: string };
  deploymentMode?: 'docker' | 'profiles';
  profiles?: ProfilesConfig;
}

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
  mode: 'docker' | 'profiles';
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
}
```

- [ ] **Step 2: Update web `types.ts`**

Replace the current contents:

```typescript
// packages/web/src/types.ts
export interface FleetInstance {
  id: string;
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
  pid?: number;            // profile mode only
}

export interface FleetStatus {
  mode: 'docker' | 'profiles';
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -30
```

Expected: only errors about missing `backend` / changed `validateInstanceId` signature — types themselves should be clean.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/types.ts packages/web/src/types.ts
git commit -m "feat: add mode/profile fields to fleet types, ProfilesConfig"
```

---

## Task 2: Update `validate.ts`

**Files:**
- Modify: `packages/server/src/validate.ts`

Note: `fastify.d.ts` is updated in Task 5, after `backend.ts` is created (importing it before it exists causes a hard `tsc` failure).

- [ ] **Step 1: Update `validate.ts`**

Replace the current contents:

```typescript
// packages/server/src/validate.ts
export const DOCKER_INSTANCE_ID_RE = /^openclaw-\d+$/;
export const PROFILE_INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function validateInstanceId(id: string, mode: 'docker' | 'profiles'): boolean {
  return mode === 'docker'
    ? DOCKER_INSTANCE_ID_RE.test(id)
    : PROFILE_INSTANCE_ID_RE.test(id);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/validate.ts
git commit -m "feat: dual-mode validateInstanceId"
```

---

## Task 3: Extend Config Schema

**Files:**
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add `deploymentMode` and `profiles` to Zod schema**

Replace the file contents:

```typescript
// packages/server/src/config.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ServerConfig } from './types.js';

const profilesSchema = z.object({
  openclawBinary: z.string().default('openclaw'),
  basePort: z.number().int().positive().default(18789),
  portStep: z.number().int().positive().default(20),
  stateBaseDir: z.string().default(join(homedir(), '.openclaw-states')),
  configBaseDir: z.string().default(join(homedir(), '.openclaw-configs')),
  autoRestart: z.boolean().default(true),
  stopTimeoutMs: z.number().int().positive().default(10000),
});

const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
  tailscale: z.object({ hostname: z.string().min(1) }).optional(),
  tls: z.object({
    cert: z.string().min(1),
    key: z.string().min(1),
  }).optional(),
  deploymentMode: z.enum(['docker', 'profiles']).default('docker'),
  profiles: profilesSchema.optional(),
});

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function loadConfig(): ServerConfig {
  const configPath = process.env.FLEET_MANAGER_CONFIG
    ?? resolve(import.meta.dirname, '..', 'server.config.json');

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  const parsed = schema.parse(raw) as ServerConfig;

  // Expand ~ in profile paths
  if (parsed.profiles) {
    parsed.profiles.stateBaseDir = expandHome(parsed.profiles.stateBaseDir);
    parsed.profiles.configBaseDir = expandHome(parsed.profiles.configBaseDir);
  }

  return parsed;
}
```

- [ ] **Step 2: Verify compile**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat: extend server config schema with deploymentMode and profiles"
```

---

## Task 4: Extract Shared `getDirectorySize` Utility

**Files:**
- Create: `packages/server/src/services/dir-utils.ts`

- [ ] **Step 1: Create `dir-utils.ts`**

```typescript
// packages/server/src/services/dir-utils.ts
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function getDirectorySize(path: string): Promise<number> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return stats.size;
    }
    const entries = await readdir(path);
    const sizes = await Promise.all(
      entries.map((entry) => getDirectorySize(join(path, entry))),
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/services/dir-utils.ts
git commit -m "feat: extract getDirectorySize as shared utility"
```

---

## Task 5: Define `DeploymentBackend` Interface

**Files:**
- Create: `packages/server/src/services/backend.ts`

- [ ] **Step 1: Create `backend.ts`**

```typescript
// packages/server/src/services/backend.ts
import type { FleetInstance, FleetStatus } from '../types.js';

export interface LogHandle {
  stop(): void;
}

export interface CreateInstanceOpts {
  name?: string;    // profile mode: required. Docker mode: ignored.
  port?: number;    // profile mode: auto-assign if omitted. Docker mode: ignored.
  config?: object;  // profile mode: written to openclaw.json. Docker mode: ignored.
}

export interface DeploymentBackend {
  // Lifecycle
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;

  // Scaling / management
  createInstance(opts: CreateInstanceOpts): Promise<FleetInstance>;
  removeInstance(id: string): Promise<void>;
  // Count-based batch scale (Docker mode only; ProfileBackend throws 'not supported')
  scaleFleet(count: number, fleetDir: string): Promise<FleetStatus>;

  // Monitoring
  getCachedStatus(): FleetStatus | null;
  refresh(): Promise<FleetStatus>;

  // Logs
  streamLogs(id: string, onData: (line: string) => void): LogHandle;
  streamAllLogs(onData: (id: string, line: string) => void): LogHandle;

  // In-process commands
  // args = tokens after "node dist/index.js" / "openclaw --profile <name>"
  execInstanceCommand(id: string, args: string[]): Promise<string>;

  // Token management
  revealToken(id: string): Promise<string>;

  // Per-instance config
  readInstanceConfig(id: string): Promise<object>;
  writeInstanceConfig(id: string, config: object): Promise<void>;

  // Init & teardown
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
```

- [ ] **Step 2: Update `fastify.d.ts`** (now that `backend.ts` exists, the import resolves correctly)

Replace the current contents:

```typescript
// packages/server/src/fastify.d.ts
import type { DeploymentBackend } from './services/backend.js';
import type { FleetConfigService } from './services/fleet-config.js';

declare module 'fastify' {
  interface FastifyInstance {
    backend: DeploymentBackend;
    deploymentMode: 'docker' | 'profiles';
    fleetConfig: FleetConfigService;
    fleetDir: string;
    proxyAuth: string;
  }
}
```

`monitor`, `docker`, `composeGenerator`, `tailscale`, `tailscaleHostname` are removed — they become internal to their respective backends.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

Expected: errors only about route files that still call `app.monitor` / `app.docker` — the type declarations themselves are now clean.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/backend.ts packages/server/src/fastify.d.ts
git commit -m "feat: define DeploymentBackend interface, update Fastify type declarations"
```

---

## Task 6: Create `DockerBackend`

**Files:**
- Create: `packages/server/src/services/docker-backend.ts`
- Create: `packages/server/tests/services/docker-backend.test.ts`

`DockerBackend` wraps `DockerService`, `ComposeGenerator`, `MonitorService`, `TailscaleService`, and `FleetConfigService`. It absorbs the Tailscale orchestration currently in `fleet.ts`.

- [ ] **Step 1: Write the test file first**

```typescript
// packages/server/tests/services/docker-backend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerBackend } from '../../src/services/docker-backend.js';

const mockDocker = {
  startContainer: vi.fn().mockResolvedValue(undefined),
  stopContainer: vi.fn().mockResolvedValue(undefined),
  restartContainer: vi.fn().mockResolvedValue(undefined),
  listFleetContainers: vi.fn().mockResolvedValue([]),
  getContainerStats: vi.fn().mockResolvedValue({ cpu: 0, memory: { used: 0, limit: 0 } }),
  inspectContainer: vi.fn().mockResolvedValue({ status: 'running', health: 'healthy', image: 'openclaw:local', uptime: 100 }),
  getDiskUsage: vi.fn().mockResolvedValue({}),
  getContainerLogs: vi.fn().mockReturnValue({ on: vi.fn(), destroy: vi.fn() }),
};

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({ portStep: 20, configBase: '/tmp/cfg', workspaceBase: '/tmp/ws' }),
  readTokens: vi.fn().mockReturnValue({ 1: 'token-abc123' }),
  readInstanceConfig: vi.fn().mockReturnValue({ gateway: {} }),
  writeInstanceConfig: vi.fn(),
  getConfigBase: vi.fn().mockReturnValue('/tmp/cfg'),
  getWorkspaceBase: vi.fn().mockReturnValue('/tmp/ws'),
};

const mockComposeGen = { generate: vi.fn() };

describe('DockerBackend', () => {
  let backend: DockerBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new DockerBackend(
      mockDocker as any,
      mockComposeGen as any,
      mockFleetConfig as any,
      '/tmp/fleet',
      null, // no tailscale
      null,
    );
  });

  it('getCachedStatus() returns null before first refresh', () => {
    expect(backend.getCachedStatus()).toBeNull();
  });

  it('start() delegates to DockerService', async () => {
    await backend.start('openclaw-1');
    expect(mockDocker.startContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('stop() delegates to DockerService', async () => {
    await backend.stop('openclaw-1');
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('restart() delegates to DockerService', async () => {
    await backend.restart('openclaw-1');
    expect(mockDocker.restartContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('revealToken() returns token from fleetConfig', async () => {
    const token = await backend.revealToken('openclaw-1');
    expect(token).toBe('token-abc123');
  });

  it('revealToken() throws for unknown instance', async () => {
    mockFleetConfig.readTokens.mockReturnValue({});
    await expect(backend.revealToken('openclaw-99')).rejects.toThrow();
  });

  it('readInstanceConfig() delegates to fleetConfig', async () => {
    const cfg = await backend.readInstanceConfig('openclaw-1');
    expect(mockFleetConfig.readInstanceConfig).toHaveBeenCalledWith(1);
    expect(cfg).toEqual({ gateway: {} });
  });

  it('writeInstanceConfig() delegates to fleetConfig', async () => {
    await backend.writeInstanceConfig('openclaw-1', { gateway: { port: 18789 } });
    expect(mockFleetConfig.writeInstanceConfig).toHaveBeenCalledWith(1, { gateway: { port: 18789 } });
  });

  it('refresh() returns FleetStatus with mode=docker', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'abc', state: 'running' },
    ]);
    const status = await backend.refresh();
    expect(status.mode).toBe('docker');
    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('openclaw-1');
    expect(status.instances[0].index).toBe(1);
  });

  it('getCachedStatus() returns the last refresh result', async () => {
    await backend.refresh();
    expect(backend.getCachedStatus()).not.toBeNull();
    expect(backend.getCachedStatus()?.mode).toBe('docker');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts 2>&1 | tail -20
```

Expected: FAIL — `docker-backend.ts` does not exist yet.

- [ ] **Step 3: Create `docker-backend.ts`**

```typescript
// packages/server/src/services/docker-backend.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import type { DockerService } from './docker.js';
import type { ComposeGenerator } from './compose-generator.js';
import type { FleetConfigService } from './fleet-config.js';
import type { TailscaleService } from './tailscale.js';
import { getDirectorySize } from './dir-utils.js';
import type { FleetInstance, FleetStatus } from '../types.js';

const execFileAsync = promisify(execFile);
export const BASE_GW_PORT = 18789;

export class DockerBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private docker: DockerService,
    private composeGenerator: ComposeGenerator,
    private fleetConfig: FleetConfigService,
    private fleetDir: string,
    private tailscale: TailscaleService | null,
    private tailscaleHostname: string | null,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    // Tailscale sync on startup (mirrors current index.ts logic)
    if (this.tailscale) {
      const containers = await this.docker.listFleetContainers().catch(() => []);
      const portStep = this.fleetConfig.readFleetConfig().portStep;
      const instances = containers.map((c) => {
        const index = parseInt(c.name.replace('openclaw-', ''), 10);
        const gwPort = BASE_GW_PORT + (index - 1) * portStep;
        return { index, gwPort };
      });
      await this.tailscale.syncAll(instances);
    }
    void this.refresh();
    this.interval = setInterval(() => { void this.refresh(); }, 5000);
  }

  async shutdown(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const containers = await this.docker.listFleetContainers();
    const tokens = this.fleetConfig.readTokens();
    const config = this.fleetConfig.readFleetConfig();
    const configBase = this.fleetConfig.getConfigBase();
    const workspaceBase = this.fleetConfig.getWorkspaceBase();

    const instances: FleetInstance[] = await Promise.all(
      containers.map(async (container) => {
        const index = parseInt(container.name.replace('openclaw-', ''), 10);
        const [stats, inspection] = await Promise.all([
          this.docker.getContainerStats(container.name).catch(() => ({
            cpu: 0,
            memory: { used: 0, limit: 0 },
          })),
          this.docker.inspectContainer(container.name).catch(() => ({
            status: container.state,
            health: 'none',
            image: 'unknown',
            uptime: 0,
          })),
        ]);

        return {
          id: container.name,
          index,
          status: this.mapStatus(inspection.status),
          port: BASE_GW_PORT + (index - 1) * config.portStep,
          token: FleetConfigService.maskToken(tokens[index] ?? ''),
          tailscaleUrl: this.tailscale?.getUrl(index) ?? undefined,
          uptime: inspection.uptime,
          cpu: stats.cpu,
          memory: stats.memory,
          disk: {
            config: await getDirectorySize(join(configBase, String(index))),
            workspace: await getDirectorySize(join(workspaceBase, String(index))),
          },
          health: this.mapHealth(inspection.health),
          image: inspection.image,
        };
      }),
    );

    // Override disk from Docker volume usage (best effort)
    try {
      const diskUsage = await this.docker.getDiskUsage();
      for (const instance of instances) {
        for (const [name, size] of Object.entries(diskUsage)) {
          if (instance.index !== undefined) {
            if (name.includes(`instances/${instance.index}`) || name.includes(`config/${instance.index}`)) {
              instance.disk.config = size;
            }
            if (name.includes(`workspaces/${instance.index}`)) {
              instance.disk.workspace = size;
            }
          }
        }
      }
    } catch {
      // best effort
    }

    const status: FleetStatus = {
      mode: 'docker',
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };

    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.docker.startContainer(id);
  }

  async stop(id: string): Promise<void> {
    await this.docker.stopContainer(id);
  }

  async restart(id: string): Promise<void> {
    await this.docker.restartContainer(id);
  }

  async createInstance(_opts: CreateInstanceOpts): Promise<FleetInstance> {
    const config = this.fleetConfig.readFleetConfig();
    const newCount = config.count + 1;
    const newIndex = newCount;

    const portMap = this.tailscale?.allocatePorts([newIndex]) ?? new Map<number, number>();
    this.composeGenerator.generate(
      newCount,
      this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: this.fleetDir });

    if (this.tailscale) {
      const gwPort = BASE_GW_PORT + (newIndex - 1) * config.portStep;
      try {
        await this.tailscale.setup(newIndex, gwPort);
      } catch (err) {
        this.log?.error({ err, newIndex }, 'Tailscale setup failed for new instance');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((i) => i.index === newIndex);
    if (!instance) throw new Error(`Instance openclaw-${newIndex} not found after creation`);
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    // Docker mode: tear down the highest-index instance (id ignored for interface compliance)
    const containers = await this.docker.listFleetContainers();
    if (containers.length === 0) return;

    const highestIndex = Math.max(...containers.map((c) => parseInt(c.name.replace('openclaw-', ''), 10)));
    const config = this.fleetConfig.readFleetConfig();
    const newCount = config.count - 1;

    await this.tailscale?.teardown(highestIndex);

    try {
      await this.docker.stopContainer(`openclaw-${highestIndex}`);
    } catch {
      // already stopped
    }

    this.composeGenerator.generate(
      newCount,
      this.tailscaleHostname ? {
        hostname: this.tailscaleHostname,
        portMap: this.tailscale?.allocatePorts([]) ?? new Map(),
      } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: this.fleetDir });
    await this.refresh();
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    // Docker log stream is a Readable from Dockerode — typed as NodeJS stream
    let logStream: import('node:stream').Readable | undefined;
    (async () => {
      logStream = await this.docker.getContainerLogs(id, { follow: true, tail: 100 }) as import('node:stream').Readable;
      logStream.on('data', (chunk: Buffer) => {
        for (const line of this.demuxDockerChunk(chunk)) {
          onData(line);
        }
      });
    })();
    return { stop: () => logStream?.destroy() };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const streams: import('node:stream').Readable[] = [];
    (async () => {
      const containers = await this.docker.listFleetContainers();
      for (const container of containers) {
        try {
          const logStream = await this.docker.getContainerLogs(
            container.name,
            { follow: true, tail: 20 },
          ) as import('node:stream').Readable;
          streams.push(logStream);
          logStream.on('data', (chunk: Buffer) => {
            for (const line of this.demuxDockerChunk(chunk)) {
              onData(container.name, line);
            }
          });
        } catch {
          // best effort per container
        }
      }
    })();
    return { stop: () => { for (const s of streams) s.destroy(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', ['exec', id, 'node', 'dist/index.js', ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const token = this.fleetConfig.readTokens()[index];
    if (!token) throw new Error(`Token not found for ${id}`);
    return token;
  }

  async readInstanceConfig(id: string): Promise<object> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    return this.fleetConfig.readInstanceConfig(index) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    this.fleetConfig.writeInstanceConfig(index, config);
  }

  // Expose for fleet.ts scale route
  async scaleFleet(count: number, fleetDir: string): Promise<FleetStatus> {
    const currentContainers = await this.docker.listFleetContainers();
    const currentIndices = currentContainers.map((c) =>
      parseInt(c.name.replace('openclaw-', ''), 10),
    );
    const newIndices = Array.from({ length: count }, (_, i) => i + 1).filter(
      (i) => !currentIndices.includes(i),
    );
    const removedIndices = currentIndices.filter((i) => i > count);

    for (const container of currentContainers.filter((c) => {
      const idx = parseInt(c.name.replace('openclaw-', ''), 10);
      return idx > count;
    })) {
      try { await this.docker.stopContainer(container.name); } catch { /* ignored */ }
    }

    for (const idx of removedIndices) {
      await this.tailscale?.teardown(idx);
    }

    const portMap = this.tailscale?.allocatePorts(newIndices) ?? new Map<number, number>();
    this.composeGenerator.generate(
      count,
      this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: fleetDir });

    const portStep = this.fleetConfig.readFleetConfig().portStep;
    for (const idx of newIndices) {
      const gwPort = BASE_GW_PORT + (idx - 1) * portStep;
      try {
        await this.tailscale?.setup(idx, gwPort);
      } catch (err) {
        this.log?.error({ err, idx }, 'Tailscale setup failed');
      }
    }

    return this.refresh();
  }

  private mapStatus(status: string): FleetInstance['status'] {
    if (status === 'running') return 'running';
    if (status === 'restarting') return 'restarting';
    if (status === 'exited' || status === 'dead' || status === 'created') return 'stopped';
    if (status === 'unhealthy') return 'unhealthy';
    return 'unknown';
  }

  private mapHealth(health: string): FleetInstance['health'] {
    if (health === 'healthy') return 'healthy';
    if (health === 'unhealthy') return 'unhealthy';
    if (health === 'starting') return 'starting';
    return 'none';
  }

  private demuxDockerChunk(chunk: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset + 8 <= chunk.length) {
      const size = chunk.readUInt32BE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > chunk.length) break;
      const text = chunk.toString('utf-8', start, end).trim();
      if (text) lines.push(...text.split('\n').map((l) => l.trim()).filter(Boolean));
      offset = end;
    }
    if (lines.length === 0) {
      const fallback = chunk.toString('utf-8').trim();
      if (fallback) lines.push(...fallback.split('\n').map((l) => l.trim()).filter(Boolean));
    }
    return lines;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/docker-backend.ts packages/server/tests/services/docker-backend.test.ts
git commit -m "feat: implement DockerBackend wrapping Docker/Monitor/Tailscale logic"
```

---

## Task 7: Create `ProfileBackend` — Registry and Process Management

**Files:**
- Create: `packages/server/src/services/profile-backend.ts`
- Create: `packages/server/tests/services/profile-backend.test.ts`

- [ ] **Step 1: Write failing tests for registry and lifecycle**

```typescript
// packages/server/tests/services/profile-backend.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfileBackend } from '../../src/services/profile-backend.js';
import type { ProfilesConfig } from '../../src/types.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as net from 'node:net';
import * as childProcess from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('node:net');
vi.mock('node:child_process');

const config: ProfilesConfig = {
  openclawBinary: 'openclaw',
  basePort: 18789,
  portStep: 20,
  stateBaseDir: '/tmp/states',
  configBaseDir: '/tmp/configs',
  autoRestart: false,
  stopTimeoutMs: 100,
};

function makeBackend() {
  return new ProfileBackend('/tmp/fleet', config);
}

describe('ProfileBackend — registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // profiles.json doesn't exist
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
  });

  it('starts with empty registry when profiles.json missing', async () => {
    const backend = makeBackend();
    await backend.initialize();
    const status = backend.getCachedStatus();
    expect(status?.instances).toHaveLength(0);
  });

  it('createInstance() validates name format', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const mockServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn((cb: () => void) => cb()) };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);

    const mockChild = { on: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => { cb(null, { stdout: '', stderr: '' }); return {} as any; });

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'INVALID NAME!' }))
      .rejects.toThrow('Invalid profile name');
  });

  it('createInstance() rejects duplicate names', async () => {
    const registry = JSON.stringify({
      profiles: { main: { name: 'main', port: 18789, pid: null, configPath: '/tmp/configs/main/openclaw.json', stateDir: '/tmp/states/main' } },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'main' }))
      .rejects.toThrow('Profile "main" already exists');
  });
});

describe('ProfileBackend — revealToken', () => {
  it('reads token from openclaw.json gateway.auth.token', async () => {
    const configJson = JSON.stringify({ gateway: { auth: { token: 'secret-token-xyz' } } });
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('openclaw.json')) return configJson;
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    const backend = makeBackend();
    await backend.initialize();

    // Inject a profile entry directly
    const registry = JSON.stringify({
      profiles: { main: { name: 'main', port: 18789, pid: null, configPath: '/tmp/configs/main/openclaw.json', stateDir: '/tmp/states/main' } },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);

    const backend2 = makeBackend();
    await backend2.initialize();
    // revealToken reads the config file
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('openclaw.json')) return configJson;
      return registry;
    });
    const token = await backend2.revealToken('main');
    expect(token).toBe('secret-token-xyz');
  });
});

describe('ProfileBackend — getCachedStatus', () => {
  it('returns mode=profiles', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const backend = makeBackend();
    await backend.initialize();
    const status = backend.getCachedStatus();
    expect(status?.mode).toBe('profiles');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts 2>&1 | tail -20
```

Expected: FAIL — `profile-backend.ts` does not exist.

- [ ] **Step 3: Create `profile-backend.ts` — registry, lifecycle, token, config**

```typescript
// packages/server/src/services/profile-backend.ts
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, createReadStream, watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import { getDirectorySize } from './dir-utils.js';
import { FleetConfigService } from './fleet-config.js';
import type { FleetInstance, FleetStatus, ProfilesConfig } from '../types.js';

const execFileAsync = promisify(execFile);
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

interface ProfileEntry {
  name: string;
  port: number;
  pid: number | null;
  configPath: string;
  stateDir: string;
}

interface ProfileRegistry {
  profiles: Record<string, ProfileEntry>;
  nextPort: number;
}

export class ProfileBackend implements DeploymentBackend {
  private registry: ProfileRegistry = { profiles: {}, nextPort: 0 };
  private processStartTimes = new Map<string, number>();
  private instanceStatus = new Map<string, FleetInstance['status']>();
  private locks = new Map<string, boolean>();
  private cache: FleetStatus | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private binaryPath = '';

  constructor(
    private fleetDir: string,
    private cfg: ProfilesConfig,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    // Resolve binary path
    try {
      const { stdout } = await execFileAsync('which', [this.cfg.openclawBinary]);
      this.binaryPath = stdout.trim();
    } catch {
      // On some systems (e.g., macOS with different PATH), try direct
      this.binaryPath = this.cfg.openclawBinary;
    }

    // Load registry
    this.registry = this.loadRegistry();
    this.registry.nextPort = this.registry.nextPort || this.cfg.basePort;

    // Validate PIDs (stale PID cleanup)
    for (const entry of Object.values(this.registry.profiles)) {
      if (entry.pid !== null) {
        const alive = await this.isPidAlive(entry.pid, entry.name);
        if (!alive) {
          entry.pid = null;
          if (this.cfg.autoRestart) {
            this.log?.info({ profile: entry.name }, 'Dead PID found on startup, will restart');
            void this.start(entry.name).catch((err) => {
              this.log?.error({ err, profile: entry.name }, 'Auto-restart on startup failed');
            });
          }
        }
      }
    }
    this.saveRegistry();

    // Initial status build + start polling
    await this.refresh();
    this.pollInterval = setInterval(() => { void this.refresh(); }, 5000);
  }

  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    // Leave processes running on server shutdown (re-adopted on next startup)
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const instances: FleetInstance[] = await Promise.all(
      Object.values(this.registry.profiles).map(async (entry) => this.buildInstance(entry)),
    );

    const status: FleetStatus = {
      mode: 'profiles',
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };
    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);
    try {
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);

      const logDir = join(this.fleetDir, 'logs');
      await mkdir(logDir, { recursive: true });
      const logFile = join(logDir, `${id}.log`);

      // Append mode so we don't lose history
      const { createWriteStream } = await import('node:fs');
      const logStream = createWriteStream(logFile, { flags: 'a' });

      const child = spawn(
        this.binaryPath,
        ['--profile', id, 'gateway', '--port', String(entry.port)],
        { stdio: ['ignore', 'pipe', 'pipe'], detached: false },
      );

      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      entry.pid = child.pid ?? null;
      this.processStartTimes.set(id, Date.now());
      this.instanceStatus.set(id, 'running');
      this.saveRegistry();

      if (this.cfg.autoRestart) {
        let startTime = Date.now();
        child.on('exit', (code, signal) => {
          this.log?.warn({ profile: id, code, signal }, 'Profile process exited');
          entry.pid = null;
          this.instanceStatus.set(id, 'stopped');
          this.saveRegistry();

          setTimeout(async () => {
            const timeSinceStart = Date.now() - startTime;
            if (timeSinceStart < 5000) {
              this.log?.error({ profile: id }, 'Process re-exited within 5s — marking unhealthy');
              this.instanceStatus.set(id, 'unhealthy');
              return;
            }
            startTime = Date.now();
            try {
              await this.start(id);
            } catch (err) {
              this.log?.error({ err, profile: id }, 'Auto-restart failed');
              this.instanceStatus.set(id, 'unhealthy');
            }
          }, 2000);
        });
      }
    } finally {
      this.locks.set(id, false);
    }
  }

  async stop(id: string): Promise<void> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);
    try {
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);
      if (entry.pid === null) return;

      await this.killProcess(entry.pid);
      entry.pid = null;
      this.instanceStatus.set(id, 'stopped');
      this.saveRegistry();
    } finally {
      this.locks.set(id, false);
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await this.start(id);
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const name = opts.name ?? '';
    if (!PROFILE_NAME_RE.test(name)) {
      throw new Error(`Invalid profile name: "${name}". Must match /^[a-z0-9][a-z0-9-]{0,62}$/`);
    }
    if (this.registry.profiles[name]) {
      throw new Error(`Profile "${name}" already exists`);
    }

    // Port assignment
    let port = opts.port ?? this.registry.nextPort;
    await this.probePort(port);

    // Paths
    const configDir = join(this.cfg.configBaseDir, name);
    const configPath = join(configDir, 'openclaw.json');
    const stateDir = join(this.cfg.stateBaseDir, name);

    // Run setup
    await execFileAsync(this.binaryPath, ['--profile', name, 'setup'], {
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
      },
    });

    // Write custom config if provided
    if (opts.config) {
      await mkdir(configDir, { recursive: true });
      const tmpPath = `${configPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(opts.config, null, 2) + '\n', 'utf-8');
      renameSync(tmpPath, configPath);
    }

    // Register
    const entry: ProfileEntry = { name, port, pid: null, configPath, stateDir };
    this.registry.profiles[name] = entry;
    if (opts.port === undefined) {
      this.registry.nextPort = port + this.cfg.portStep;
    }
    this.saveRegistry();

    // Start
    await this.start(name);
    await this.refresh();

    const instance = this.cache?.instances.find((i) => i.id === name);
    if (!instance) throw new Error(`Instance "${name}" not found after creation`);
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    await this.stop(id).catch(() => {});
    delete this.registry.profiles[id];
    this.instanceStatus.delete(id);
    this.processStartTimes.delete(id);
    this.saveRegistry();
    await this.refresh();
  }

  async scaleFleet(_count: number, _fleetDir: string): Promise<FleetStatus> {
    throw new Error('scaleFleet not supported in profile mode — use createInstance/removeInstance');
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    const logFile = join(this.fleetDir, 'logs', `${id}.log`);
    let stopped = false;
    let watcher: ReturnType<typeof watch> | null = null;
    let position = 0;

    const readNew = () => {
      if (stopped) return;
      try {
        const stream = createReadStream(logFile, { start: position, encoding: 'utf-8' });
        let buf = '';
        stream.on('data', (chunk: string) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) onData(line.trim());
          }
        });
        stream.on('end', () => {
          position += Buffer.byteLength(buf, 'utf-8');
        });
        stream.on('error', () => {});
      } catch {
        // file may not exist yet
      }
    };

    // Read existing content first
    readNew();

    if (existsSync(logFile)) {
      watcher = watch(logFile, () => readNew());
    }

    return {
      stop: () => {
        stopped = true;
        watcher?.close();
      },
    };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const handles = Object.keys(this.registry.profiles).map((name) =>
      this.streamLogs(name, (line) => onData(name, line)),
    );
    return { stop: () => { for (const h of handles) h.stop(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const { stdout } = await execFileAsync(this.binaryPath, ['--profile', id, ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const raw = readFileSync(entry.configPath, 'utf-8');
    const cfg = JSON.parse(raw) as { gateway?: { auth?: { token?: string } } };
    const token = cfg?.gateway?.auth?.token;
    if (!token) throw new Error(`Token not found in config for profile "${id}"`);
    return token;
  }

  async readInstanceConfig(id: string): Promise<object> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    return JSON.parse(readFileSync(entry.configPath, 'utf-8')) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const tmpPath = `${entry.configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, entry.configPath);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async buildInstance(entry: ProfileEntry): Promise<FleetInstance> {
    // Health check
    let health: FleetInstance['health'] = 'none';
    let status: FleetInstance['status'] = this.instanceStatus.get(entry.name) ?? 'stopped';

    if (entry.pid !== null) {
      try {
        const res = await fetch(`http://127.0.0.1:${entry.port}/healthz`);
        health = res.ok ? 'healthy' : 'unhealthy';
        status = res.ok ? 'running' : 'unhealthy';
      } catch {
        // healthz unreachable — check PID
        const alive = await this.isPidAlive(entry.pid, entry.name);
        status = alive ? 'running' : 'stopped';
        if (!alive) {
          entry.pid = null;
          this.saveRegistry();
        }
      }
    }

    // Stats
    const { cpu, memUsed, memLimit } = await this.getProcessStats(entry.pid);
    const startTime = this.processStartTimes.get(entry.name) ?? 0;
    const uptime = status === 'running' && startTime > 0 ? Math.floor((Date.now() - startTime) / 1000) : 0;

    // Disk
    const configDir = dirname(entry.configPath);
    const [configSize, stateSize] = await Promise.all([
      getDirectorySize(configDir),
      getDirectorySize(entry.stateDir),
    ]);

    return {
      id: entry.name,
      profile: entry.name,
      pid: entry.pid ?? undefined,
      status,
      port: entry.port,
      token: FleetConfigService.maskToken(''),  // masked until revealed
      uptime,
      cpu,
      memory: { used: memUsed, limit: memLimit },
      disk: { config: configSize, workspace: stateSize },
      health,
      image: this.binaryPath,
    };
  }

  private async getProcessStats(pid: number | null): Promise<{ cpu: number; memUsed: number; memLimit: number }> {
    if (pid === null) return { cpu: 0, memUsed: 0, memLimit: 0 };
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=,rss=']);
      const [cpuStr, rssStr] = stdout.trim().split(/\s+/);
      return {
        cpu: parseFloat(cpuStr ?? '0') || 0,
        memUsed: parseInt(rssStr ?? '0', 10) * 1024, // KB to bytes
        memLimit: 0, // no hard limit in native mode
      };
    } catch {
      return { cpu: 0, memUsed: 0, memLimit: 0 };
    }
  }

  private async isPidAlive(pid: number, profileName: string): Promise<boolean> {
    try {
      process.kill(pid, 0);
      // Verify cmdline contains our profile
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']).catch(() => ({ stdout: '' }));
      return stdout.includes('openclaw') && stdout.includes(profileName);
    } catch {
      return false;
    }
  }

  private async killProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
        resolve();
      }, this.cfg.stopTimeoutMs);
      const check = setInterval(() => {
        try {
          process.kill(pid, 0);
        } catch {
          clearTimeout(deadline);
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  private async probePort(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve());
      });
      server.on('error', () => {
        reject(new Error(`Port ${port} is already in use`));
      });
    });
  }

  private loadRegistry(): ProfileRegistry {
    const path = join(this.fleetDir, 'profiles.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ProfileRegistry;
    } catch {
      return { profiles: {}, nextPort: this.cfg.basePort };
    }
  }

  private saveRegistry(): void {
    const path = join(this.fleetDir, 'profiles.json');
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.registry, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, path);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/profile-backend.ts packages/server/tests/services/profile-backend.test.ts
git commit -m "feat: implement ProfileBackend with process management, registry, token, config"
```

---

## Task 8: Update `index.ts` — Backend Factory

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Rewrite `index.ts`**

```typescript
// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { configRoutes } from './routes/config.js';
import { fleetRoutes } from './routes/fleet.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { logRoutes } from './routes/logs.js';
import { proxyRoutes } from './routes/proxy.js';
import { DockerBackend } from './services/docker-backend.js';
import { ProfileBackend } from './services/profile-backend.js';
import { ComposeGenerator } from './services/compose-generator.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { TailscaleService } from './services/tailscale.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Note: profileRoutes is loaded dynamically below to avoid a static import failure
// when profiles.ts does not yet exist in the build.

const execFileAsync = promisify(execFile);
const config = loadConfig();

// ── Tailscale preflight (Docker mode only) ──────────────────────────────────
let tailscale: TailscaleService | null = null;
if (config.deploymentMode !== 'profiles' && config.tailscale) {
  try {
    await execFileAsync('tailscale', ['version']);
  } catch {
    console.error(
      'ERROR: tailscale.hostname is configured but the tailscale CLI is not available.\n' +
      'Install and authenticate Tailscale before starting the fleet manager.',
    );
    process.exit(1);
  }
  tailscale = new TailscaleService(config.fleetDir, config.tailscale.hostname);
}

// ── TLS ─────────────────────────────────────────────────────────────────────
const httpsOptions = config.tls
  ? { key: readFileSync(resolve(config.tls.key)), cert: readFileSync(resolve(config.tls.cert)) }
  : undefined;

const app = Fastify({ logger: true, ...(httpsOptions ? { https: httpsOptions } : {}) });

// ── Shared services ──────────────────────────────────────────────────────────
const fleetConfig = new FleetConfigService(config.fleetDir);

// ── Backend factory ──────────────────────────────────────────────────────────
const backend = config.deploymentMode === 'profiles'
  ? new ProfileBackend(config.fleetDir, config.profiles ?? {
      openclawBinary: 'openclaw',
      basePort: 18789,
      portStep: 20,
      stateBaseDir: `${process.env.HOME}/.openclaw-states`,
      configBaseDir: `${process.env.HOME}/.openclaw-configs`,
      autoRestart: true,
      stopTimeoutMs: 10000,
    }, app.log)
  : new DockerBackend(
      new DockerService(),
      new ComposeGenerator(config.fleetDir),
      fleetConfig,
      config.fleetDir,
      tailscale,
      config.tailscale?.hostname ?? null,
      app.log,
    );

// ── Decorators ───────────────────────────────────────────────────────────────
app.decorate('backend', backend);
app.decorate('deploymentMode', config.deploymentMode ?? 'docker');
app.decorate('fleetConfig', fleetConfig);
app.decorate('fleetDir', config.fleetDir);
app.decorate('proxyAuth', Buffer.from(
  `${config.auth.username}:${config.auth.password}`, 'utf-8',
).toString('base64'));

// ── Routes ───────────────────────────────────────────────────────────────────
await registerAuth(app, config);
await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(configRoutes);
await app.register(fleetRoutes);
await app.register(instanceRoutes);
await app.register(logRoutes);
await app.register(proxyRoutes);

if (config.deploymentMode === 'profiles') {
  const { profileRoutes } = await import('./routes/profiles.js');
  await app.register(profileRoutes);
}

const webDist = resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/ws/') ||
      request.url.startsWith('/proxy/') ||
      request.url.startsWith('/proxy-ws/')
    ) {
      return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    }
    return reply.sendFile('index.html');
  });
}

app.server.on('connection', (socket) => { socket.on('error', () => {}); });

// ── Startup ──────────────────────────────────────────────────────────────────
await backend.initialize();

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  await backend.shutdown();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: config.port, host: '0.0.0.0' });
const proto = config.tls ? 'https' : 'http';
console.log(`Claw Fleet Manager running at ${proto}://0.0.0.0:${config.port}`);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -40
```

Expected: errors only from routes that still reference `app.monitor` / `app.docker` — those will be fixed in the next task.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: backend factory in index.ts, replace monitor/docker decorators with backend"
```

---

## Task 9: Adapt Server Routes

**Files:**
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/src/routes/instances.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/logs.ts`

> **TDD note:** Write the updated test files (Task 11 Steps 5–8) FIRST so they fail against the current routes, then update the routes to make them pass.

- [ ] **Step 0: Write updated tests BEFORE changing routes**

Write the complete `config.test.ts` and `logs.test.ts` replacements from Task 11 Steps 5–6 NOW, then run to confirm they fail:

```bash
cd packages/server && npx vitest run tests/routes/config.test.ts tests/routes/logs.test.ts 2>&1 | tail -20
```

Expected: FAIL — routes still use old decorators. Then proceed with route rewrites below.

- [ ] **Step 1: Rewrite `fleet.ts`**

```typescript
// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const scaleSchema = z.object({ count: z.number().int().positive() });
let scaling = false;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async () => {
    return app.backend.getCachedStatus()
      ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
  });

  app.post('/api/fleet/scale', async (request, reply) => {
    if (app.deploymentMode === 'profiles') {
      return reply.status(400).send({
        error: 'scale endpoint not available in profile mode — use POST /api/fleet/profiles',
        code: 'WRONG_MODE',
      });
    }

    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'count must be a positive integer', code: 'INVALID_COUNT' });
    }

    if (scaling) {
      return reply.status(409).send({ error: 'Scale operation already in progress', code: 'SCALE_IN_PROGRESS' });
    }
    scaling = true;

    try {
      const { count } = parsed.data;
      // scaleFleet() is on the DeploymentBackend interface; ProfileBackend throws 'not supported'
      const status = await app.backend.scaleFleet(count, app.fleetDir);
      return { ok: true, fleet: status };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'SCALE_FAILED' });
    } finally {
      scaling = false;
    }
  });
}
```

- [ ] **Step 2: Rewrite `instances.ts`**

```typescript
// packages/server/src/routes/instances.ts
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEISHU_CODE_RE = /^[A-Za-z0-9]{3,32}$/;

function parseFeishuPairing(stdout: string): { code: string; userId?: string }[] {
  const results: { code: string; userId?: string }[] = [];
  const headerWords = new Set(['PENDING', 'CODE', 'STATUS', 'USER', 'TIME', 'REQUEST']);
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('=')) continue;
    const codeMatch = trimmed.match(/\b([A-Z0-9]{4,12})\b/);
    const userIdMatch = trimmed.match(/\b(ou_[a-zA-Z0-9_]+)\b/);
    if (codeMatch && !headerWords.has(codeMatch[1])) {
      results.push({ code: codeMatch[1], userId: userIdMatch?.[1] });
    }
  }
  return results;
}

function parsePendingDevices(output: string): { requestId: string; ip: string }[] {
  const pendingSection = output.split(/\nPaired/)[0];
  const devices: { requestId: string; ip: string }[] = [];
  for (const line of pendingSection.split('\n')) {
    const uuidMatch = line.match(/│\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+│/);
    if (!uuidMatch) continue;
    const ipMatch = line.match(/│[^│]*│[^│]*│[^│]*│\s+([\d.]+)\s+│/);
    devices.push({ requestId: uuidMatch[1], ip: ipMatch?.[1] ?? 'unknown' });
  }
  return devices;
}

export async function instanceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/:id/start', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.start(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'START_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/stop', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.stop(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'STOP_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/restart', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.restart(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'RESTART_FAILED' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/devices/pending', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      const stdout = await app.backend.execInstanceCommand(id, ['devices', 'list']);
      return { pending: parsePendingDevices(stdout) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'DEVICES_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; requestId: string } }>(
    '/api/fleet/:id/devices/:requestId/approve',
    async (request, reply) => {
      const { id, requestId } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!UUID_RE.test(requestId)) {
        return reply.status(400).send({ error: 'Invalid requestId', code: 'INVALID_REQUEST_ID' });
      }
      try {
        await app.backend.execInstanceCommand(id, ['devices', 'approve', requestId]);
        return { ok: true };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'APPROVE_FAILED' });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/fleet/:id/feishu/pairing', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      const stdout = await app.backend.execInstanceCommand(id, ['pairing', 'list', 'feishu']);
      return { pending: parseFeishuPairing(stdout), raw: stdout };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'FEISHU_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; code: string } }>(
    '/api/fleet/:id/feishu/pairing/:code/approve',
    async (request, reply) => {
      const { id, code } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!FEISHU_CODE_RE.test(code)) {
        return reply.status(400).send({ error: 'Invalid pairing code', code: 'INVALID_CODE' });
      }
      try {
        await app.backend.execInstanceCommand(id, ['pairing', 'approve', 'feishu', code]);
        return { ok: true };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'FEISHU_APPROVE_FAILED' });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/fleet/:id/token/reveal', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      const token = await app.backend.revealToken(id);
      request.log.info({ instance: id }, 'Token revealed');
      return { token };
    } catch {
      return reply.status(404).send({ error: 'Token not found', code: 'TOKEN_NOT_FOUND' });
    }
  });
}
```

- [ ] **Step 3: Rewrite `config.ts`**

```typescript
// packages/server/src/routes/config.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateInstanceId } from '../validate.js';

const fleetConfigBodySchema = z.record(z.string(), z.string());
const instanceConfigBodySchema = z.record(z.string(), z.unknown());

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/fleet', async () => app.fleetConfig.readFleetConfig());

  app.put('/api/config/fleet', async (request, reply) => {
    const parsed = fleetConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a Record<string, string>', code: 'INVALID_BODY' });
    }
    app.fleetConfig.writeFleetConfig(parsed.data);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      return await app.backend.readInstanceConfig(id);
    } catch {
      return reply.status(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id, app.deploymentMode)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    const parsed = instanceConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a JSON object', code: 'INVALID_BODY' });
    }
    try {
      await app.backend.writeInstanceConfig(id, parsed.data as object);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'CONFIG_WRITE_FAILED' });
    }
  });
}
```

- [ ] **Step 4: Rewrite `logs.ts`**

```typescript
// packages/server/src/routes/logs.ts
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';

export async function logRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/logs/:id',
    { websocket: true },
    async (socket: any, request) => {
      const { id } = request.params;

      if (!validateInstanceId(id, app.deploymentMode)) {
        socket.send(JSON.stringify({ error: 'Invalid instance id' }));
        socket.close();
        return;
      }

      const handle = app.backend.streamLogs(id, (line) => {
        socket.send(JSON.stringify({ id, line, ts: Date.now() }));
      });

      socket.on('close', () => handle.stop());
    },
  );

  app.get('/ws/logs', { websocket: true }, async (socket: any) => {
    const handle = app.backend.streamAllLogs((id, line) => {
      socket.send(JSON.stringify({ id, line, ts: Date.now() }));
    });

    socket.on('close', () => handle.stop());
  });
}
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors (or only errors from `profiles.ts` not yet created).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/fleet.ts packages/server/src/routes/instances.ts packages/server/src/routes/config.ts packages/server/src/routes/logs.ts
git commit -m "feat: adapt all routes to use app.backend instead of app.monitor/docker"
```

---

## Task 10: Create `profiles.ts` Route

**Files:**
- Create: `packages/server/src/routes/profiles.ts`
- Create: `packages/server/tests/routes/profiles.test.ts`

- [ ] **Step 1: Write test**

```typescript
// packages/server/tests/routes/profiles.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { profileRoutes } from '../../src/routes/profiles.js';

const mockInstance = {
  id: 'main',
  profile: 'main',
  status: 'running',
  port: 18789,
  token: 'abc1***f456',
  uptime: 100,
  cpu: 0,
  memory: { used: 0, limit: 0 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy',
  image: '/usr/local/bin/openclaw',
};

const mockBackend = {
  createInstance: vi.fn().mockResolvedValue(mockInstance),
  removeInstance: vi.fn().mockResolvedValue(undefined),
  getCachedStatus: vi.fn().mockReturnValue({
    mode: 'profiles',
    instances: [mockInstance],
    totalRunning: 1,
    updatedAt: Date.now(),
  }),
};

describe('Profile routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    await app.register(profileRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet/profiles returns instances', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/profiles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().instances[0].id).toBe('main');
  });

  it('POST /api/fleet/profiles creates a profile', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/profiles',
      payload: { name: 'rescue', port: 19001 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({ name: 'rescue', port: 19001, config: undefined });
    expect(res.json().id).toBe('main');
  });

  it('POST /api/fleet/profiles rejects missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/profiles',
      payload: { port: 19001 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/fleet/profiles/:name removes a profile', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/fleet/profiles/rescue' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.removeInstance).toHaveBeenCalledWith('rescue');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd packages/server && npx vitest run tests/routes/profiles.test.ts 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Create `profiles.ts`**

```typescript
// packages/server/src/routes/profiles.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const createProfileSchema = z.object({
  name: z.string().regex(PROFILE_NAME_RE, 'name must be lowercase alphanumeric with hyphens'),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/fleet/profiles', async () => {
    const status = app.backend.getCachedStatus();
    return { instances: status?.instances ?? [], mode: 'profiles' };
  });

  app.post('/api/fleet/profiles', async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }
    try {
      const { name, port, config } = parsed.data;
      const instance = await app.backend.createInstance({ name, port, config: config as object | undefined });
      return instance;
    } catch (error: any) {
      const code = error.message?.includes('already exists') ? 409
        : error.message?.includes('in use') ? 409 : 500;
      return reply.status(code).send({ error: error.message, code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { name: string } }>('/api/fleet/profiles/:name', async (request, reply) => {
    const { name } = request.params;
    if (!PROFILE_NAME_RE.test(name)) {
      return reply.status(400).send({ error: 'Invalid profile name', code: 'INVALID_NAME' });
    }
    try {
      await app.backend.removeInstance(name);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'REMOVE_FAILED' });
    }
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run tests/routes/profiles.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/profiles.ts packages/server/tests/routes/profiles.test.ts
git commit -m "feat: add profile CRUD routes (profile mode only)"
```

---

## Task 11: Update Existing Route Tests

**Files:**
- Modify: `packages/server/tests/routes/fleet.test.ts`
- Modify: `packages/server/tests/routes/instances.test.ts`
- Modify: `packages/server/tests/routes/config.test.ts`
- Modify: `packages/server/tests/routes/logs.test.ts`

These tests use `app.decorate('monitor', ...)`, `app.decorate('docker', ...)`, etc. They need to be updated to use a mock `backend` instead.

- [ ] **Step 1: Run existing tests to see current failures**

```bash
cd packages/server && npx vitest run tests/routes/ 2>&1 | tail -40
```

- [ ] **Step 2: Rewrite `fleet.test.ts`**

Replace the full contents:

```typescript
// packages/server/tests/routes/fleet.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { fleetRoutes } from '../../src/routes/fleet.js';

const mockStatus = {
  mode: 'docker' as const,
  instances: [
    { id: 'openclaw-1', index: 1, status: 'running', port: 18789, token: 'abc1***f456',
      uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
      health: 'healthy', image: 'openclaw:local' },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
  scaleFleet: vi.fn().mockResolvedValue(mockStatus),
};

describe('Fleet routes', () => {
  const app = Fastify();

  beforeEach(() => { vi.clearAllMocks(); mockBackend.getCachedStatus.mockReturnValue(mockStatus); });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    app.decorate('fleetDir', '/tmp');
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet returns fleet status with mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('docker');
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().totalRunning).toBe(1);
  });

  it('GET /api/fleet returns empty status when cache is null', async () => {
    mockBackend.getCachedStatus.mockReturnValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(0);
  });

  it('POST /api/fleet/scale delegates to backend.scaleFleet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    expect([200, 500]).toContain(res.statusCode);
    expect(mockBackend.scaleFleet).toHaveBeenCalledWith(3, '/tmp');
  });

  it('POST /api/fleet/scale validates count', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: -1 } });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/scale returns 409 when already scaling', async () => {
    let release: (() => void) | null = null;
    let started: (() => void) | null = null;
    const startedP = new Promise<void>((r) => { started = r; });

    mockBackend.scaleFleet.mockImplementationOnce(() => {
      started?.();
      return new Promise<typeof mockStatus>((r) => { release = () => r(mockStatus); });
    });

    const first = app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } });
    await startedP;
    const second = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    release?.();
    const firstRes = await first;

    expect(second.statusCode).toBe(409);
    expect(firstRes.statusCode).toBe(200);
  });
});

describe('Fleet routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', { getCachedStatus: vi.fn().mockReturnValue(null) });
    app.decorate('deploymentMode', 'profiles');
    app.decorate('fleetDir', '/tmp');
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/scale returns 400 in profile mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('WRONG_MODE');
  });
});
```

- [ ] **Step 3: Rewrite `instances.test.ts`**

Replace the full contents:

```typescript
// packages/server/tests/routes/instances.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const mockInstance = {
  id: 'openclaw-1', index: 1, status: 'running', port: 18789, token: 'abc1***f456',
  uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
  health: 'healthy', image: 'openclaw:local',
};

const mockFleetStatus = { mode: 'docker' as const, instances: [mockInstance], totalRunning: 1, updatedAt: Date.now() };

const mockBackend = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(mockFleetStatus),
  revealToken: vi.fn().mockResolvedValue('full-token-abc123def456'),
  execInstanceCommand: vi.fn().mockResolvedValue(''),
};

describe('Instance routes — docker mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/:id/start calls backend.start', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('openclaw-1');
    expect(res.json().instance.id).toBe('openclaw-1');
  });

  it('POST /api/fleet/:id/stop calls backend.stop', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.stop).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/restart calls backend.restart', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/restart' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.restart).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/token/reveal returns token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBe('full-token-abc123def456');
  });

  it('rejects invalid docker instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/main/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});

describe('Instance routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('accepts profile name as instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/main/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('main');
  });

  it('rejects docker-style id in profile mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
```

- [ ] **Step 4: Run all route tests to see which now fail**

```bash
cd packages/server && npx vitest run tests/routes/ 2>&1 | tail -50
```

Expected: `fleet.test.ts` and `instances.test.ts` FAIL (wrong decorators). `config.test.ts` and `logs.test.ts` also FAIL because they reference removed decorators. Confirm all four are broken before proceeding.

- [ ] **Step 5: Replace `config.test.ts` completely**

```typescript
// packages/server/tests/routes/config.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { configRoutes } from '../../src/routes/config.js';

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-***123',
    modelId: 'gpt-4',
    count: 3,
    cpuLimit: '4',
    memLimit: '8G',
    portStep: 20,
    configBase: '/tmp/instances',
    workspaceBase: '/tmp/workspaces',
    tz: 'UTC',
  }),
  writeFleetConfig: vi.fn(),
};

const mockBackend = {
  readInstanceConfig: vi.fn().mockResolvedValue({ gateway: { mode: 'token' } }),
  writeInstanceConfig: vi.fn().mockResolvedValue(undefined),
};

describe('Config routes — docker mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    await app.register(configRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/config/fleet returns masked fleet config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiKey).toBe('sk-***123');
  });

  it('PUT /api/config/fleet writes config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_URL: 'https://new.api.com', API_KEY: 'sk-new' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.writeFleetConfig).toHaveBeenCalled();
  });

  it('GET /api/fleet/:id/config returns instance config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().gateway.mode).toBe('token');
    expect(mockBackend.readInstanceConfig).toHaveBeenCalledWith('openclaw-1');
  });

  it('PUT /api/fleet/:id/config writes instance config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/fleet/openclaw-1/config',
      payload: { gateway: { mode: 'local' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.writeInstanceConfig).toHaveBeenCalledWith('openclaw-1', { gateway: { mode: 'local' } });
  });

  it('PUT /api/config/fleet rejects non-string values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { COUNT: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_BODY');
  });

  it('rejects invalid docker instance id on GET config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/evil-container/config' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });

  it('rejects invalid docker instance id on PUT config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/fleet/evil-container/config',
      payload: { key: 'value' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});

describe('Config routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    await app.register(configRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('accepts profile name as instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/main/config' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.readInstanceConfig).toHaveBeenCalledWith('main');
  });
});
```

- [ ] **Step 6: Replace `logs.test.ts` completely**

```typescript
// packages/server/tests/routes/logs.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { logRoutes } from '../../src/routes/logs.js';

describe('Log routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', {
      streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
      streamAllLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    });
    app.decorate('deploymentMode', 'docker');
    await app.register(fastifyWebsocket);
    await app.register(logRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('has /ws/logs/:id route registered', () => {
    const routes = app.printRoutes();
    expect(routes).toContain('ws/logs');
    expect(routes).toContain(':id');
  });

  it('has /ws/logs route registered', () => {
    const routes = app.printRoutes();
    expect(routes).toContain('ws/logs');
  });
});
```

- [ ] **Step 7: Run full test suite**

```bash
cd packages/server && npx vitest run 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/tests/routes/
git commit -m "test: update route tests to use backend abstraction"
```

---

## Task 12: Web UI — Types and API Client

**Files:**
- Modify: `packages/web/src/api/fleet.ts`

- [ ] **Step 1: Add `createProfile` and `deleteProfile` to `fleet.ts`**

Append to the end of `packages/web/src/api/fleet.ts`:

```typescript
export interface CreateProfileOpts {
  name: string;
  port?: number;
  config?: object;
}

export const createProfile = (opts: CreateProfileOpts) =>
  apiFetch<FleetInstance>('/api/fleet/profiles', {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export const deleteProfile = (name: string) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/profiles/${name}`, { method: 'DELETE' });
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/api/fleet.ts
git commit -m "feat: add createProfile/deleteProfile API client functions"
```

---

## Task 13: Web UI — Sidebar with Add Profile Button

**Files:**
- Create: `packages/web/src/components/instances/AddProfileDialog.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create `AddProfileDialog.tsx`**

```tsx
// packages/web/src/components/instances/AddProfileDialog.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProfile } from '../../api/fleet';

interface Props {
  onClose: () => void;
}

export function AddProfileDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => createProfile({
      name,
      port: port ? parseInt(port, 10) : undefined,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const nameValid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>Add Profile</h2>

        <label className="field-label">
          Profile name <span className="muted">(lowercase, hyphens allowed)</span>
        </label>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="main"
          autoFocus
        />

        <label className="field-label" style={{ marginTop: '0.75rem' }}>
          Gateway port <span className="muted">(leave blank to auto-assign)</span>
        </label>
        <input
          className="text-input"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="18789"
          type="number"
        />

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => create.mutate()}
            disabled={!nameValid || create.isPending}
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `Sidebar.tsx` to show Add Profile button in profile mode**

```tsx
// packages/web/src/components/layout/Sidebar.tsx
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';
import { AddProfileDialog } from '../instances/AddProfileDialog';
import { deleteProfile } from '../../api/fleet';

export function Sidebar() {
  const { data, isLoading, error } = useFleet();
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const queryClient = useQueryClient();
  const [showAddProfile, setShowAddProfile] = useState(false);

  useEffect(() => {
    if (!data?.instances.length || selectedInstanceId) return;
    selectInstance(data.instances[0].id);
  }, [data, selectInstance, selectedInstanceId]);

  const removeProfile = useMutation({
    mutationFn: (name: string) => deleteProfile(name),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['fleet'] }); },
  });

  const isProfileMode = data?.mode === 'profiles';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="pill">Fleet Manager</p>
        <h1 className="sidebar-title">Claw Fleet</h1>
        <p className="sidebar-subtitle">
          {data ? `${data.totalRunning}/${data.instances.length} running` : isLoading ? 'Loading fleet...' : 'Awaiting server'}
        </p>
        {error ? <p className="error-text">{error.message}</p> : null}
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section">Instances</p>
        {data?.instances.map((instance) => (
          <SidebarItem
            key={instance.id}
            instance={instance}
            selected={instance.id === selectedInstanceId}
            onClick={() => selectInstance(instance.id)}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        {isProfileMode ? (
          <button className="primary-button" onClick={() => setShowAddProfile(true)}>
            + Add Profile
          </button>
        ) : null}
        <button className="secondary-button" onClick={() => selectInstance(null)}>
          Fleet Config
        </button>
      </div>

      {showAddProfile ? <AddProfileDialog onClose={() => setShowAddProfile(false)} /> : null}
    </aside>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/instances/AddProfileDialog.tsx packages/web/src/components/layout/Sidebar.tsx
git commit -m "feat: add AddProfileDialog and profile-mode Sidebar controls"
```

---

## Task 14: Web UI — Instance Panel Profile Label

**Files:**
- Modify: `packages/web/src/components/instances/InstancePanel.tsx`
- Modify: `packages/web/src/components/instances/OverviewTab.tsx`

- [ ] **Step 1: Update `InstancePanel.tsx` to show profile name**

In `InstancePanel.tsx`, change the pill display:

```tsx
// Before:
<p className="pill mono">{instance.id}</p>

// After:
<p className="pill mono">{instance.profile ?? instance.id}</p>
```

- [ ] **Step 2: Update `OverviewTab.tsx` to show profile/PID info**

Replace the `section-grid` block that shows Port/Uptime/Image/Health with a profile-aware version. Find this block in `OverviewTab.tsx` (lines ~64–81):

```tsx
// Before:
        <div className="section-grid">
          <div className="metric-card">
            <p className="metric-label">Port</p>
            <p className="metric-value mono">:{instance.port}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">Uptime</p>
            <p className="metric-value">{formatUptime(instance.uptime)}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">Image</p>
            <p className="metric-value mono">{instance.image}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">Health</p>
            <p className="metric-value">{instance.health}</p>
          </div>
        </div>

// After:
        <div className="section-grid">
          <div className="metric-card">
            <p className="metric-label">Port</p>
            <p className="metric-value mono">:{instance.port}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">Uptime</p>
            <p className="metric-value">{formatUptime(instance.uptime)}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{instance.profile ? 'Profile' : 'Image'}</p>
            <p className="metric-value mono">{instance.profile ?? instance.image}</p>
          </div>
          {instance.pid !== undefined ? (
            <div className="metric-card">
              <p className="metric-label">PID</p>
              <p className="metric-value mono">{instance.pid}</p>
            </div>
          ) : (
            <div className="metric-card">
              <p className="metric-label">Health</p>
              <p className="metric-value">{instance.health}</p>
            </div>
          )}
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/instances/InstancePanel.tsx packages/web/src/components/instances/OverviewTab.tsx
git commit -m "feat: show profile name in instance panel header and overview tab"
```

---

## Task 15: Update Config Example and Verify Full Build

**Files:**
- Modify: `packages/server/server.config.example.json`

- [ ] **Step 1: Read the existing example config**

```bash
cat packages/server/server.config.example.json
```

- [ ] **Step 2: Add profile mode example**

Add a commented section (as a separate key block) to the example:

```json
{
  "_comment_docker_mode": "Default mode — requires Docker",
  "port": 3001,
  "auth": { "username": "admin", "password": "change-me" },
  "fleetDir": "/path/to/your/openclaw-fleet",
  "deploymentMode": "docker",

  "_comment_profile_mode": "Uncomment deploymentMode and profiles block to use native profiles",
  "_deploymentMode": "profiles",
  "_profiles": {
    "openclawBinary": "openclaw",
    "basePort": 18789,
    "portStep": 20,
    "stateBaseDir": "~/.openclaw-states",
    "configBaseDir": "~/.openclaw-configs",
    "autoRestart": true,
    "stopTimeoutMs": 10000
  },

  "tailscale": { "hostname": "your-machine.tailnet.ts.net" },
  "tls": { "cert": "/path/to/cert.pem", "key": "/path/to/key.pem" }
}
```

- [ ] **Step 3: Run the full server test suite**

```bash
cd packages/server && npx vitest run 2>&1 | tail -30
```

Expected: All tests PASS.

- [ ] **Step 4: Run TypeScript compile**

```bash
cd packages/server && npx tsc --noEmit && cd ../web && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: 0 lint errors.

- [ ] **Step 6: Final commit**

```bash
git add packages/server/server.config.example.json
git commit -m "docs: update server.config.example.json with profile mode example"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `cd packages/server && npx vitest run` — all tests pass
- [ ] `cd packages/server && npx tsc --noEmit` — 0 type errors
- [ ] `cd packages/web && npx tsc --noEmit` — 0 type errors
- [ ] `npm run lint` — 0 lint errors
- [ ] `npm run build` — builds successfully
- [ ] Set `deploymentMode: "docker"` in server config → existing Docker behavior unchanged
- [ ] Set `deploymentMode: "profiles"` in server config → profile mode active, Add Profile button shown in sidebar
