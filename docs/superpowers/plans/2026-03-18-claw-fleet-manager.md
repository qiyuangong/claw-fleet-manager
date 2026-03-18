# Claw Fleet Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based management UI for claw-fleet that provides dashboard monitoring, instance lifecycle control, config editing, log streaming, and fleet scaling — accessible from any LAN device.

**Architecture:** TypeScript monorepo (npm workspaces + Turborepo) with a Fastify backend talking to Docker via dockerode, and a React + Vite frontend using shadcn/ui. The backend reads/writes the same config files as the existing CLI tools. WebSocket for log streaming, React Query polling for status.

**Tech Stack:** Node.js 20+, TypeScript, Fastify, dockerode, React 18, Vite, TanStack React Query, Zustand, shadcn/ui, Tailwind CSS, Recharts, Monaco Editor, Vitest

**Spec:** `docs/superpowers/specs/2026-03-18-claw-fleet-manager-design.md`

---

## File Map

### Root
- `package.json` — npm workspaces root
- `turbo.json` — Turborepo dev/build pipeline
- `.gitignore` — Node, build artifacts, server.config.json
- `tsconfig.base.json` — shared TypeScript config

### `packages/server/`
- `package.json`, `tsconfig.json`
- `server.config.example.json` — template with placeholder values
- `src/index.ts` — Fastify app entry, plugin registration, startup
- `src/auth.ts` — @fastify/basic-auth setup
- `src/config.ts` — Load and validate server.config.json
- `src/types.ts` — FleetInstance, FleetConfig, FleetStatus interfaces
- `src/services/docker.ts` — dockerode wrapper: list, start, stop, restart, stats, df
- `src/services/fleet-config.ts` — Parse fleet.env, read .env tokens, read/write per-instance openclaw.json
- `src/services/monitor.ts` — 5s polling loop, in-memory stats cache
- `src/services/compose-generator.ts` — Rewrite docker-compose.yml (port of setup.sh template logic)
- `src/routes/fleet.ts` — GET /api/fleet, POST /api/fleet/scale
- `src/routes/instances.ts` — POST lifecycle + token reveal
- `src/routes/config.ts` — GET/PUT /api/config/fleet, GET/PUT /api/fleet/:id/config
- `src/routes/health.ts` — GET /api/health
- `src/routes/logs.ts` — WebSocket upgrade for log streaming
- `tests/services/docker.test.ts`
- `tests/services/fleet-config.test.ts`
- `tests/services/compose-generator.test.ts`
- `tests/routes/fleet.test.ts`
- `tests/routes/instances.test.ts`
- `tests/routes/config.test.ts`
- `tests/routes/logs.test.ts`

### `packages/web/`
- `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`
- `index.html`
- `src/main.tsx` — React entry
- `src/App.tsx` — Router, providers (React Query, Zustand)
- `src/types.ts` — FleetInstance, FleetConfig (mirrors server types)
- `src/api/client.ts` — Fetch wrapper with Basic Auth headers
- `src/api/fleet.ts` — API functions: getFleet, startInstance, stopInstance, etc.
- `src/hooks/useFleet.ts` — React Query: polls /api/fleet every 5s
- `src/hooks/useInstanceConfig.ts` — Load/save per-instance openclaw.json
- `src/hooks/useFleetConfig.ts` — Load/save fleet.env
- `src/hooks/useLogs.ts` — WebSocket lifecycle, 1000-line ring buffer
- `src/store.ts` — Zustand: selected instance ID, active tab
- `src/components/layout/Shell.tsx` — App shell: sidebar + main panel
- `src/components/layout/Sidebar.tsx` — Instance list + fleet config link
- `src/components/layout/SidebarItem.tsx` — Single instance: status dot + name
- `src/components/instances/InstancePanel.tsx` — Tab container for selected instance
- `src/components/instances/OverviewTab.tsx` — Status, controls, token, CPU/mem
- `src/components/instances/LogsTab.tsx` — Log viewer with streaming
- `src/components/instances/ConfigTab.tsx` — Monaco JSON editor
- `src/components/instances/MetricsTab.tsx` — Recharts sparklines + disk
- `src/components/config/FleetConfigPanel.tsx` — fleet.env form + scale control
- `src/components/common/StatusBadge.tsx` — Colored status indicator
- `src/components/common/MaskedValue.tsx` — Masked text with copy + reveal
- `src/components/common/ConfirmDialog.tsx` — Confirmation modal (scale-down)

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`, `turbo.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "claw-fleet-manager",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.4.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["build"] },
    "lint": {}
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
server.config.json
.superpowers/
.env.local
```

- [ ] **Step 5: Create packages/server/package.json**

```json
{
  "name": "@claw-fleet-manager/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "@fastify/basic-auth": "^6.0.0",
    "@fastify/static": "^8.1.0",
    "@fastify/websocket": "^11.0.0",
    "dockerode": "^4.0.4",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/dockerode": "^3.3.34",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "vitest": "^3.1.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 6: Create packages/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create packages/server/server.config.example.json**

```json
{
  "port": 3001,
  "auth": { "username": "admin", "password": "changeme" },
  "fleetDir": "/path/to/claw-fleet/openclaw"
}
```

- [ ] **Step 8: Scaffold packages/web with Vite**

Run:
```bash
cd packages && npm create vite@latest web -- --template react-ts
```

Then update `packages/web/package.json` to set `"name": "@claw-fleet-manager/web"` and `"private": true`.

- [ ] **Step 9: Install dependencies**

Run:
```bash
npm install
```

- [ ] **Step 10: Verify monorepo works**

Run:
```bash
npx turbo run build
```
Expected: both packages build successfully (web may have default Vite app, server may be empty — that's fine).

- [ ] **Step 11: Initialize git and commit**

```bash
git init
git add -A
git commit -m "feat: scaffold monorepo with server and web packages"
```

---

## Task 2: Server Config + Health Route

**Files:**
- Create: `packages/server/src/types.ts`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/index.ts`
- Test: `packages/server/tests/routes/health.test.ts`

- [ ] **Step 1: Write types.ts**

```typescript
// packages/server/src/types.ts
export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
}

export interface FleetInstance {
  id: string;
  index: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string; // always masked
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
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
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
}
```

- [ ] **Step 2: Write config.ts**

```typescript
// packages/server/src/config.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ServerConfig } from './types.js';

const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
});

export function loadConfig(): ServerConfig {
  const configPath = process.env.FLEET_MANAGER_CONFIG
    ?? resolve(import.meta.dirname, '..', 'server.config.json');

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return schema.parse(raw);
}
```

- [ ] **Step 3: Write auth.ts**

```typescript
// packages/server/src/auth.ts
import type { FastifyInstance } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import type { ServerConfig } from './types.js';

export async function registerAuth(app: FastifyInstance, config: ServerConfig) {
  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== config.auth.username || password !== config.auth.password) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'Claw Fleet Manager' },
  });
  app.addHook('onRequest', app.basicAuth);
}
```

- [ ] **Step 4: Write health route**

```typescript
// packages/server/src/routes/health.ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    return { ok: true, timestamp: Date.now() };
  });
}
```

- [ ] **Step 5: Write index.ts (app entry)**

```typescript
// packages/server/src/index.ts
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { healthRoutes } from './routes/health.js';

const config = loadConfig();
const app = Fastify({ logger: true });

await registerAuth(app, config);
await app.register(healthRoutes);

await app.listen({ port: config.port, host: '0.0.0.0' });
```

- [ ] **Step 6: Write health route test**

```typescript
// packages/server/tests/routes/health.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from '../../src/routes/health.js';

describe('GET /api/health', () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns ok and timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.timestamp).toBeTypeOf('number');
  });
});
```

- [ ] **Step 7: Add vitest config**

Create `packages/server/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 8: Run tests**

Run: `cd packages/server && npx vitest run`
Expected: 1 test passes.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src packages/server/tests packages/server/vitest.config.ts
git commit -m "feat(server): add config loading, basic auth, and health route"
```

---

## Task 3: Fleet Config Service

**Files:**
- Create: `packages/server/src/services/fleet-config.ts`
- Test: `packages/server/tests/services/fleet-config.test.ts`

This service reads/writes the existing claw-fleet config files: `fleet.env`, `.env` (tokens), and per-instance `openclaw.json`.

- [ ] **Step 1: Write failing test for parseFleetEnv**

```typescript
// packages/server/tests/services/fleet-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { FleetConfigService } from '../../src/services/fleet-config.js';

describe('FleetConfigService', () => {
  let dir: string;
  let svc: FleetConfigService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-test-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    svc = new FleetConfigService(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('readFleetConfig', () => {
    it('parses fleet.env with defaults', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), [
        'BASE_URL=https://api.example.com/v1',
        'API_KEY=sk-test123',
        'MODEL_ID=gpt-4',
        'COUNT=3',
      ].join('\n'));

      const config = svc.readFleetConfig();
      expect(config.baseUrl).toBe('https://api.example.com/v1');
      expect(config.apiKey).toBe('sk-***123');
      expect(config.modelId).toBe('gpt-4');
      expect(config.count).toBe(3);
      expect(config.cpuLimit).toBe('4');
      expect(config.memLimit).toBe('8G');
      expect(config.portStep).toBe(20);
    });
  });

  describe('readTokens', () => {
    it('reads tokens from .env file', () => {
      writeFileSync(join(dir, '.env'), [
        'TOKEN_1=abc123def',
        'TOKEN_2=xyz789ghi',
      ].join('\n'));

      const tokens = svc.readTokens();
      expect(tokens).toEqual({ 1: 'abc123def', 2: 'xyz789ghi' });
    });
  });

  describe('maskToken', () => {
    it('masks middle of token', () => {
      expect(FleetConfigService.maskToken('abc123def456')).toBe('abc1***f456');
    });
  });

  describe('readInstanceConfig', () => {
    it('reads openclaw.json for instance', () => {
      const configBase = join(dir, 'instances');
      mkdirSync(join(configBase, '1'), { recursive: true });
      writeFileSync(join(configBase, '1', 'openclaw.json'), '{"gateway":{}}');

      writeFileSync(join(dir, 'config', 'fleet.env'), `CONFIG_BASE=${configBase}`);

      const config = svc.readInstanceConfig(1);
      expect(config).toEqual({ gateway: {} });
    });
  });

  describe('writeInstanceConfig', () => {
    it('atomically writes openclaw.json', () => {
      const configBase = join(dir, 'instances');
      mkdirSync(join(configBase, '2'), { recursive: true });
      writeFileSync(join(configBase, '2', 'openclaw.json'), '{}');
      writeFileSync(join(dir, 'config', 'fleet.env'), `CONFIG_BASE=${configBase}`);

      svc.writeInstanceConfig(2, { gateway: { mode: 'token' } });

      const written = JSON.parse(readFileSync(join(configBase, '2', 'openclaw.json'), 'utf-8'));
      expect(written.gateway.mode).toBe('token');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/services/fleet-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement FleetConfigService**

```typescript
// packages/server/src/services/fleet-config.ts
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { FleetConfig } from '../types.js';

export class FleetConfigService {
  constructor(private fleetDir: string) {}

  /** Parse config/fleet.env into FleetConfig. API key is masked. */
  readFleetConfig(): FleetConfig {
    const envPath = join(this.fleetDir, 'config', 'fleet.env');
    const vars = this.parseEnvFile(envPath);

    return {
      baseUrl: vars.BASE_URL ?? '',
      apiKey: vars.API_KEY ? FleetConfigService.maskToken(vars.API_KEY) : '',
      modelId: vars.MODEL_ID ?? '',
      count: parseInt(vars.COUNT ?? '2', 10),
      cpuLimit: vars.CPU_LIMIT ?? '4',
      memLimit: vars.MEM_LIMIT ?? '8G',
      portStep: parseInt(vars.PORT_STEP ?? '20', 10),
      configBase: vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances'),
      workspaceBase: vars.WORKSPACE_BASE ?? join(process.env.HOME ?? '', 'openclaw-workspaces'),
      tz: vars.TZ ?? 'Asia/Shanghai',
    };
  }

  /** Read raw fleet.env (unmasked) for writing back. */
  readFleetEnvRaw(): Record<string, string> {
    return this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));
  }

  /** Write fleet.env from key-value pairs. */
  writeFleetConfig(vars: Record<string, string>): void {
    const envPath = join(this.fleetDir, 'config', 'fleet.env');
    const lines = Object.entries(vars)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${v}`);
    this.atomicWrite(envPath, lines.join('\n') + '\n');
  }

  /** Read TOKEN_N= lines from .env file. Returns { index: fullToken }. */
  readTokens(): Record<number, string> {
    const envPath = join(this.fleetDir, '.env');
    let content: string;
    try {
      content = readFileSync(envPath, 'utf-8');
    } catch {
      return {};
    }

    const tokens: Record<number, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^TOKEN_(\d+)=(.+)$/);
      if (match) {
        tokens[parseInt(match[1], 10)] = match[2];
      }
    }
    return tokens;
  }

  /** Get the configBase path from fleet.env. */
  getConfigBase(): string {
    const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));
    return vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances');
  }

  /** Read openclaw.json for a given instance index. */
  readInstanceConfig(index: number): unknown {
    const configBase = this.getConfigBase();
    const path = join(configBase, String(index), 'openclaw.json');
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  /** Atomically write openclaw.json for a given instance index. */
  writeInstanceConfig(index: number, config: unknown): void {
    const configBase = this.getConfigBase();
    const path = join(configBase, String(index), 'openclaw.json');
    this.atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
  }

  static maskToken(token: string): string {
    if (token.length <= 7) return '***';
    return token.slice(0, 4) + '***' + token.slice(-4);
  }

  private parseEnvFile(path: string): Record<string, string> {
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      return {};
    }

    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
    return vars;
  }

  private atomicWrite(path: string, content: string): void {
    const tmpPath = path + '.tmp';
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, path);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx vitest run tests/services/fleet-config.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/fleet-config.ts packages/server/tests/services/fleet-config.test.ts
git commit -m "feat(server): add fleet config service for reading/writing fleet.env and instance configs"
```

---

## Task 4: Docker Service

**Files:**
- Create: `packages/server/src/services/docker.ts`
- Test: `packages/server/tests/services/docker.test.ts`

Wraps dockerode for container operations. Tests use a mock Docker client.

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/tests/services/docker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerService } from '../../src/services/docker.js';

const mockContainer = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  stats: vi.fn().mockResolvedValue({
    cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 50 }, system_cpu_usage: 500 },
    memory_stats: { usage: 420_000_000, limit: 8_000_000_000 },
  }),
  inspect: vi.fn().mockResolvedValue({
    State: { Status: 'running', StartedAt: new Date(Date.now() - 86400_000).toISOString(), Health: { Status: 'healthy' } },
    Config: { Image: 'openclaw:local' },
  }),
  logs: vi.fn().mockResolvedValue({ on: vi.fn(), destroy: vi.fn() }),
};

const mockDocker = {
  listContainers: vi.fn().mockResolvedValue([
    { Names: ['/openclaw-1'], Id: 'abc123', State: 'running' },
    { Names: ['/openclaw-2'], Id: 'def456', State: 'running' },
  ]),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  df: vi.fn().mockResolvedValue({ Volumes: [] }),
};

describe('DockerService', () => {
  let svc: DockerService;

  beforeEach(() => {
    svc = new DockerService(mockDocker as any);
  });

  it('lists fleet containers', async () => {
    const containers = await svc.listFleetContainers();
    expect(containers).toHaveLength(2);
    expect(containers[0].name).toBe('openclaw-1');
  });

  it('starts a container', async () => {
    await svc.startContainer('openclaw-1');
    expect(mockDocker.getContainer).toHaveBeenCalledWith('openclaw-1');
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('stops a container', async () => {
    await svc.stopContainer('openclaw-1');
    expect(mockContainer.stop).toHaveBeenCalled();
  });

  it('restarts a container', async () => {
    await svc.restartContainer('openclaw-1');
    expect(mockContainer.restart).toHaveBeenCalled();
  });

  it('gets container stats', async () => {
    const stats = await svc.getContainerStats('openclaw-1');
    expect(stats.cpu).toBeTypeOf('number');
    expect(stats.memory.used).toBe(420_000_000);
    expect(stats.memory.limit).toBe(8_000_000_000);
  });

  it('inspects a container', async () => {
    const info = await svc.inspectContainer('openclaw-1');
    expect(info.status).toBe('running');
    expect(info.health).toBe('healthy');
    expect(info.image).toBe('openclaw:local');
    expect(info.uptime).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DockerService**

```typescript
// packages/server/src/services/docker.ts
import Dockerode from 'dockerode';

export interface ContainerInfo {
  name: string;
  id: string;
  state: string;
}

export interface ContainerStats {
  cpu: number;
  memory: { used: number; limit: number };
}

export interface ContainerInspection {
  status: string;
  health: string;
  image: string;
  uptime: number;
}

export class DockerService {
  constructor(private docker: Dockerode = new Dockerode()) {}

  async listFleetContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((c) => c.Names.some((n) => /^\/openclaw-\d+$/.test(n)))
      .map((c) => ({
        name: c.Names[0].replace(/^\//, ''),
        id: c.Id,
        state: c.State,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async startContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).start();
  }

  async stopContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).stop();
  }

  async restartContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).restart();
  }

  async getContainerStats(name: string): Promise<ContainerStats> {
    const stats = await this.docker.getContainer(name).stats({ stream: false }) as any;

    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpus = stats.cpu_stats.online_cpus || 1;
    const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

    return {
      cpu: Math.round(cpu * 100) / 100,
      memory: {
        used: stats.memory_stats.usage ?? 0,
        limit: stats.memory_stats.limit ?? 0,
      },
    };
  }

  async inspectContainer(name: string): Promise<ContainerInspection> {
    const info = await this.docker.getContainer(name).inspect();
    const startedAt = new Date(info.State.StartedAt).getTime();
    const uptime = info.State.Status === 'running' ? Math.floor((Date.now() - startedAt) / 1000) : 0;

    return {
      status: info.State.Status,
      health: info.State.Health?.Status ?? 'none',
      image: info.Config.Image,
      uptime,
    };
  }

  async getDiskUsage(): Promise<Record<string, number>> {
    const df = await this.docker.df() as any;
    const result: Record<string, number> = {};
    for (const vol of df.Volumes ?? []) {
      result[vol.Name] = vol.UsageData?.Size ?? 0;
    }
    return result;
  }

  getContainerLogs(name: string, opts: { follow: boolean; tail: number }) {
    return this.docker.getContainer(name).logs({
      follow: opts.follow,
      stdout: true,
      stderr: true,
      tail: opts.tail,
      timestamps: true,
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/docker.ts packages/server/tests/services/docker.test.ts
git commit -m "feat(server): add Docker service with container lifecycle and stats"
```

---

## Task 5: Monitor Service

**Files:**
- Create: `packages/server/src/services/monitor.ts`
- Test: `packages/server/tests/services/monitor.test.ts`

Polls Docker every 5 seconds, builds FleetStatus, caches it in memory.

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/tests/services/monitor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MonitorService } from '../../src/services/monitor.js';

const mockDocker = {
  listFleetContainers: vi.fn().mockResolvedValue([
    { name: 'openclaw-1', id: 'abc', state: 'running' },
  ]),
  getContainerStats: vi.fn().mockResolvedValue({
    cpu: 12.5,
    memory: { used: 420_000_000, limit: 8_000_000_000 },
  }),
  inspectContainer: vi.fn().mockResolvedValue({
    status: 'running',
    health: 'healthy',
    image: 'openclaw:local',
    uptime: 86400,
  }),
  getDiskUsage: vi.fn().mockResolvedValue({}),
};

const mockFleetConfig = {
  readTokens: vi.fn().mockReturnValue({ 1: 'abc123def456' }),
  readFleetConfig: vi.fn().mockReturnValue({ portStep: 20 }),
};

describe('MonitorService', () => {
  let svc: MonitorService;

  beforeEach(() => {
    svc = new MonitorService(mockDocker as any, mockFleetConfig as any);
  });

  afterEach(() => {
    svc.stop();
  });

  it('builds fleet status from Docker state', async () => {
    const status = await svc.refresh();
    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('openclaw-1');
    expect(status.instances[0].cpu).toBe(12.5);
    expect(status.instances[0].status).toBe('running');
    expect(status.instances[0].token).toBe('abc1***f456'); // masked
    expect(status.instances[0].port).toBe(18789);
    expect(status.totalRunning).toBe(1);
  });

  it('returns cached status via getStatus()', async () => {
    await svc.refresh();
    const cached = svc.getStatus();
    expect(cached).not.toBeNull();
    expect(cached!.instances).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/services/monitor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement MonitorService**

```typescript
// packages/server/src/services/monitor.ts
import type { FleetInstance, FleetStatus } from '../types.js';
import type { DockerService } from './docker.js';
import type { FleetConfigService } from './fleet-config.js';

const BASE_GW_PORT = 18789;

export class MonitorService {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private docker: DockerService,
    private fleetConfig: FleetConfigService,
  ) {}

  start(intervalMs = 5000): void {
    this.refresh();
    this.interval = setInterval(() => this.refresh(), intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const containers = await this.docker.listFleetContainers();
    const tokens = this.fleetConfig.readTokens();
    const config = this.fleetConfig.readFleetConfig();
    const portStep = config.portStep;

    const instances: FleetInstance[] = await Promise.all(
      containers.map(async (c) => {
        const index = parseInt(c.name.replace('openclaw-', ''), 10);
        const [stats, inspection] = await Promise.all([
          this.docker.getContainerStats(c.name).catch(() => ({ cpu: 0, memory: { used: 0, limit: 0 } })),
          this.docker.inspectContainer(c.name).catch(() => ({
            status: c.state,
            health: 'none' as const,
            image: 'unknown',
            uptime: 0,
          })),
        ]);

        const fullToken = tokens[index] ?? '';

        return {
          id: c.name,
          index,
          status: this.mapStatus(inspection.status),
          port: BASE_GW_PORT + (index - 1) * portStep,
          token: FleetConfigService.maskToken(fullToken),
          uptime: inspection.uptime,
          cpu: stats.cpu,
          memory: stats.memory,
          disk: { config: 0, workspace: 0 }, // populated below if available
          health: this.mapHealth(inspection.health),
          image: inspection.image,
        };
      }),
    );

    // Attempt disk usage
    try {
      const diskUsage = await this.docker.getDiskUsage();
      for (const inst of instances) {
        // volume names depend on Docker compose project — best effort
        for (const [name, size] of Object.entries(diskUsage)) {
          if (name.includes(`instances/${inst.index}`) || name.includes(`config/${inst.index}`)) {
            inst.disk.config = size;
          }
          if (name.includes(`workspaces/${inst.index}`)) {
            inst.disk.workspace = size;
          }
        }
      }
    } catch {
      // disk usage is best-effort
    }

    const status: FleetStatus = {
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };

    this.cache = status;
    return status;
  }

  private mapStatus(s: string): FleetInstance['status'] {
    if (s === 'running') return 'running';
    if (s === 'restarting') return 'restarting';
    if (s === 'exited' || s === 'dead' || s === 'created') return 'stopped';
    if (s === 'unhealthy') return 'unhealthy';
    return 'unknown';
  }

  private mapHealth(h: string): FleetInstance['health'] {
    if (h === 'healthy') return 'healthy';
    if (h === 'unhealthy') return 'unhealthy';
    if (h === 'starting') return 'starting';
    return 'none';
  }
}
```

- [ ] **Step 4: Import FleetConfigService.maskToken in monitor**

The `MonitorService` uses `FleetConfigService.maskToken()` — make sure the import is present (already in the code above).

- [ ] **Step 5: Run tests**

Run: `cd packages/server && npx vitest run tests/services/monitor.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/monitor.ts packages/server/tests/services/monitor.test.ts
git commit -m "feat(server): add monitor service with 5s polling and fleet status cache"
```

---

## Task 6: Compose Generator Service

**Files:**
- Create: `packages/server/src/services/compose-generator.ts`
- Test: `packages/server/tests/services/compose-generator.test.ts`

Ports the docker-compose.yml generation logic from `setup.sh` to TypeScript, used by the scale operation.

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/tests/services/compose-generator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { ComposeGenerator } from '../../src/services/compose-generator.js';

describe('ComposeGenerator', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'fleet.env'), [
      'BASE_URL=https://api.example.com/v1',
      'API_KEY=sk-test',
      'MODEL_ID=test-model',
      'CPU_LIMIT=2',
      'MEM_LIMIT=4G',
      'PORT_STEP=20',
      `CONFIG_BASE=${join(dir, 'instances')}`,
      `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
    ].join('\n'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates docker-compose.yml for N instances', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(3);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    expect(content).toContain('openclaw-1:');
    expect(content).toContain('openclaw-2:');
    expect(content).toContain('openclaw-3:');
    expect(content).toContain('"18789:18789"');
    expect(content).toContain('"18809:18789"');
    expect(content).toContain('"18829:18789"');
    expect(content).toContain('cpus: "2"');
    expect(content).toContain('memory: 4G');
    expect(content).toContain('net-openclaw-1:');
    expect(content).toContain('net-openclaw-2:');
    expect(content).toContain('net-openclaw-3:');
  });

  it('preserves existing tokens when regenerating', () => {
    writeFileSync(join(dir, '.env'), 'TOKEN_1=existingtoken123\nTOKEN_2=othertoken456\n');

    const gen = new ComposeGenerator(dir);
    gen.generate(3);

    const envContent = readFileSync(join(dir, '.env'), 'utf-8');
    expect(envContent).toContain('TOKEN_1=existingtoken123');
    expect(envContent).toContain('TOKEN_2=othertoken456');
    expect(envContent).toContain('TOKEN_3='); // new token generated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/services/compose-generator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement ComposeGenerator**

```typescript
// packages/server/src/services/compose-generator.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FleetConfigService } from './fleet-config.js';

const BASE_GW_PORT = 18789;

export class ComposeGenerator {
  private fleetConfig: FleetConfigService;

  constructor(private fleetDir: string) {
    this.fleetConfig = new FleetConfigService(fleetDir);
  }

  generate(count: number): void {
    const vars = this.fleetConfig.readFleetEnvRaw();
    const portStep = parseInt(vars.PORT_STEP ?? '20', 10);
    const cpuLimit = vars.CPU_LIMIT ?? '4';
    const memLimit = vars.MEM_LIMIT ?? '8G';
    const configBase = vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances');
    const workspaceBase = vars.WORKSPACE_BASE ?? join(process.env.HOME ?? '', 'openclaw-workspaces');

    // Read existing tokens
    const existingTokens = this.fleetConfig.readTokens();
    const tokens: Record<number, string> = {};

    for (let i = 1; i <= count; i++) {
      tokens[i] = existingTokens[i] ?? randomBytes(32).toString('hex');
      // Ensure directories exist
      mkdirSync(join(configBase, String(i)), { recursive: true });
      mkdirSync(join(workspaceBase, String(i)), { recursive: true });
    }

    // Write .env
    const envLines = Object.entries(tokens).map(([idx, token]) => `TOKEN_${idx}=${token}`);
    writeFileSync(join(this.fleetDir, '.env'), envLines.join('\n') + '\n');

    // Write docker-compose.yml
    const services: string[] = [];
    for (let i = 1; i <= count; i++) {
      const svc = `openclaw-${i}`;
      const gwPort = BASE_GW_PORT + (i - 1) * portStep;
      const configDir = join(configBase, String(i));
      const workspaceDir = join(workspaceBase, String(i));

      services.push(`  ${svc}:
    image: \${OPENCLAW_IMAGE:-openclaw:local}
    pull_policy: never
    container_name: ${svc}
    networks:
      - net-${svc}
    environment:
      HOME: /home/node
      TERM: xterm-256color
      OPENCLAW_GATEWAY_TOKEN: "\${TOKEN_${i}}"
      TZ: "\${TZ:-Asia/Shanghai}"
    volumes:
      - ${configDir}:/home/node/.openclaw
      - ${workspaceDir}:/home/node/.openclaw/workspace
    ports:
      - "${gwPort}:18789"
    deploy:
      resources:
        limits:
          cpus: "${cpuLimit}"
          memory: ${memLimit}
    init: true
    restart: unless-stopped
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    command:
      ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]
    healthcheck:
      test:
        ["CMD", "node", "-e",
         "fetch('http://127.0.0.1:18789/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s`);
    }

    const networks = Array.from({ length: count }, (_, i) =>
      `  net-openclaw-${i + 1}:\n    driver: bridge`
    ).join('\n');

    const compose = `# Auto-generated by claw-fleet-manager -- do not edit manually
services:
${services.join('\n\n')}

networks:
${networks}
`;

    writeFileSync(join(this.fleetDir, 'docker-compose.yml'), compose);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && npx vitest run tests/services/compose-generator.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/compose-generator.ts packages/server/tests/services/compose-generator.test.ts
git commit -m "feat(server): add compose generator for fleet scaling"
```

---

## Task 7: Fleet + Scale + Instance Routes

**Files:**
- Create: `packages/server/src/routes/fleet.ts`
- Create: `packages/server/src/routes/instances.ts`
- Test: `packages/server/tests/routes/fleet.test.ts`
- Test: `packages/server/tests/routes/instances.test.ts`

- [ ] **Step 1: Write fleet route tests**

```typescript
// packages/server/tests/routes/fleet.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { fleetRoutes } from '../../src/routes/fleet.js';

const mockStatus = {
  instances: [
    { id: 'openclaw-1', index: 1, status: 'running', port: 18789, token: 'abc1***f456', uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 }, health: 'healthy', image: 'openclaw:local' },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockMonitor = { getStatus: vi.fn().mockReturnValue(mockStatus), refresh: vi.fn().mockResolvedValue(mockStatus) };
const mockComposeGen = { generate: vi.fn() };
const mockDocker = { stopContainer: vi.fn(), listFleetContainers: vi.fn().mockResolvedValue([]) };

describe('Fleet routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor);
    app.decorate('composeGenerator', mockComposeGen);
    app.decorate('docker', mockDocker);
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet returns fleet status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.instances).toHaveLength(1);
    expect(body.totalRunning).toBe(1);
  });

  it('POST /api/fleet/scale validates count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/scale with valid count succeeds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockComposeGen.generate).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Implement fleet routes**

```typescript
// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const scaleSchema = z.object({ count: z.number().int().positive() });

export async function fleetRoutes(app: FastifyInstance) {
  // Registered BEFORE /:id routes to avoid param collision
  app.get('/api/fleet', async () => {
    const status = app.monitor.getStatus();
    if (!status) {
      return { instances: [], totalRunning: 0, updatedAt: Date.now() };
    }
    return status;
  });

  app.post('/api/fleet/scale', async (request, reply) => {
    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'count must be a positive integer', code: 'INVALID_COUNT' });
    }

    const { count } = parsed.data;

    // If scaling down, stop containers being removed
    const currentContainers = await app.docker.listFleetContainers();
    const toRemove = currentContainers.filter((c) => {
      const idx = parseInt(c.name.replace('openclaw-', ''), 10);
      return idx > count;
    });

    for (const c of toRemove) {
      try {
        await app.docker.stopContainer(c.name);
      } catch {
        // may already be stopped
      }
    }

    // Regenerate docker-compose.yml
    app.composeGenerator.generate(count);

    // Apply via docker compose up -d
    try {
      await execFileAsync('docker', ['compose', 'up', '-d'], {
        cwd: app.fleetDir,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: 'COMPOSE_FAILED' });
    }

    const status = await app.monitor.refresh();
    return { ok: true, fleet: status };
  });
}
```

- [ ] **Step 3: Write instance route tests**

```typescript
// packages/server/tests/routes/instances.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const mockInstance = {
  id: 'openclaw-1', index: 1, status: 'running', port: 18789,
  token: 'abc1***f456', uptime: 100, cpu: 12,
  memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
  health: 'healthy', image: 'openclaw:local',
};

const mockMonitor = {
  refresh: vi.fn().mockResolvedValue({ instances: [mockInstance], totalRunning: 1, updatedAt: Date.now() }),
};
const mockDocker = {
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  restartContainer: vi.fn(),
};
const mockFleetConfig = {
  readTokens: vi.fn().mockReturnValue({ 1: 'full-token-abc123def456' }),
};

describe('Instance routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor);
    app.decorate('docker', mockDocker);
    app.decorate('fleetConfig', mockFleetConfig);
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/:id/start starts container and returns instance', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.startContainer).toHaveBeenCalledWith('openclaw-1');
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.instance.id).toBe('openclaw-1');
  });

  it('POST /api/fleet/:id/stop stops container', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/restart restarts container', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/restart' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.restartContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/token/reveal returns full token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBe('full-token-abc123def456');
  });
});
```

- [ ] **Step 4: Implement instance routes**

```typescript
// packages/server/src/routes/instances.ts
import type { FastifyInstance } from 'fastify';

export async function instanceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/:id/start', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.docker.startContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((i) => i.id === id);
      return { ok: true, instance };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: 'START_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/stop', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.docker.stopContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((i) => i.id === id);
      return { ok: true, instance };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: 'STOP_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/restart', async (request, reply) => {
    const { id } = request.params;
    try {
      await app.docker.restartContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((i) => i.id === id);
      return { ok: true, instance };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: 'RESTART_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/token/reveal', async (request, reply) => {
    const { id } = request.params;
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const tokens = app.fleetConfig.readTokens();
    const token = tokens[index];
    if (!token) {
      return reply.status(404).send({ error: 'Token not found', code: 'TOKEN_NOT_FOUND' });
    }
    request.log.info({ instance: id }, 'Token revealed');
    return { token };
  });
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/routes/instances.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/fleet.ts packages/server/src/routes/instances.ts packages/server/tests/routes/
git commit -m "feat(server): add fleet status, scale, and instance lifecycle routes"
```

---

## Task 8: Config Routes

**Files:**
- Create: `packages/server/src/routes/config.ts`
- Test: `packages/server/tests/routes/config.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/tests/routes/config.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { configRoutes } from '../../src/routes/config.js';

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({
    baseUrl: 'https://api.example.com', apiKey: 'sk-***123',
    modelId: 'gpt-4', count: 3, cpuLimit: '4', memLimit: '8G',
    portStep: 20, configBase: '/tmp/instances', workspaceBase: '/tmp/workspaces', tz: 'UTC',
  }),
  readFleetEnvRaw: vi.fn().mockReturnValue({ BASE_URL: 'https://api.example.com', API_KEY: 'sk-test123' }),
  writeFleetConfig: vi.fn(),
  readInstanceConfig: vi.fn().mockReturnValue({ gateway: { mode: 'token' } }),
  writeInstanceConfig: vi.fn(),
};

describe('Config routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
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
      method: 'PUT', url: '/api/config/fleet',
      payload: { BASE_URL: 'https://new.api.com', API_KEY: 'sk-new' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.writeFleetConfig).toHaveBeenCalled();
  });

  it('GET /api/fleet/:id/config returns instance config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().gateway.mode).toBe('token');
  });

  it('PUT /api/fleet/:id/config writes instance config', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/fleet/openclaw-1/config',
      payload: { gateway: { mode: 'local' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.writeInstanceConfig).toHaveBeenCalledWith(1, { gateway: { mode: 'local' } });
  });
});
```

- [ ] **Step 2: Implement config routes**

```typescript
// packages/server/src/routes/config.ts
import type { FastifyInstance } from 'fastify';

export async function configRoutes(app: FastifyInstance) {
  // Fleet-level config — registered before /:id routes
  app.get('/api/config/fleet', async () => {
    return app.fleetConfig.readFleetConfig();
  });

  app.put('/api/config/fleet', async (request) => {
    app.fleetConfig.writeFleetConfig(request.body as Record<string, string>);
    return { ok: true };
  });

  // Per-instance config
  app.get<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const index = parseInt(request.params.id.replace('openclaw-', ''), 10);
    try {
      const config = app.fleetConfig.readInstanceConfig(index);
      return config;
    } catch (err: any) {
      return reply.status(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const index = parseInt(request.params.id.replace('openclaw-', ''), 10);
    try {
      app.fleetConfig.writeInstanceConfig(index, request.body);
      return { ok: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: 'CONFIG_WRITE_FAILED' });
    }
  });
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/server && npx vitest run tests/routes/config.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/config.ts packages/server/tests/routes/config.test.ts
git commit -m "feat(server): add fleet and instance config routes"
```

---

## Task 9: WebSocket Log Streaming

**Files:**
- Create: `packages/server/src/routes/logs.ts`
- Test: `packages/server/tests/routes/logs.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/server/tests/routes/logs.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { logRoutes } from '../../src/routes/logs.js';

// Note: full WebSocket tests require a running server. We test the route registration
// and verify the stream is created — integration test with real WS is deferred to manual testing.
describe('Log routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    const mockStream = { on: vi.fn(), destroy: vi.fn() };
    app.decorate('docker', {
      getContainerLogs: vi.fn().mockResolvedValue(mockStream),
    });
    await app.register(fastifyWebsocket);
    await app.register(logRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('has /ws/logs/:id route registered', () => {
    // Fastify registers WebSocket routes — verify the route exists
    const route = app.printRoutes();
    expect(route).toContain('/ws/logs/:id');
  });
});
```

- [ ] **Step 2: Implement log streaming route**

```typescript
// packages/server/src/routes/logs.ts
import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';

export async function logRoutes(app: FastifyInstance) {
  // Single instance log stream
  app.get<{ Params: { id: string } }>('/ws/logs/:id', { websocket: true }, async (socket: SocketStream, request) => {
    const { id } = request.params;

    let logStream: any;
    try {
      logStream = await app.docker.getContainerLogs(id, { follow: true, tail: 100 });
    } catch (err: any) {
      socket.send(JSON.stringify({ error: err.message }));
      socket.close();
      return;
    }

    logStream.on('data', (chunk: Buffer) => {
      // Docker stream has 8-byte header per frame; strip it for simplicity
      const line = chunk.toString('utf-8').replace(/^.{8}/, '').trim();
      if (line) {
        socket.send(JSON.stringify({ id, line, ts: Date.now() }));
      }
    });

    logStream.on('end', () => socket.close());
    logStream.on('error', (err: Error) => {
      socket.send(JSON.stringify({ error: err.message }));
      socket.close();
    });

    socket.on('close', () => {
      logStream.destroy();
    });
  });

  // Multiplexed log stream (all instances)
  app.get('/ws/logs', { websocket: true }, async (socket: SocketStream) => {
    const containers = await app.docker.listFleetContainers();
    const streams: any[] = [];

    for (const c of containers) {
      try {
        const logStream = await app.docker.getContainerLogs(c.name, { follow: true, tail: 20 });
        streams.push(logStream);

        logStream.on('data', (chunk: Buffer) => {
          const line = chunk.toString('utf-8').replace(/^.{8}/, '').trim();
          if (line) {
            socket.send(JSON.stringify({ id: c.name, line, ts: Date.now() }));
          }
        });
      } catch {
        // skip containers that can't be logged
      }
    }

    socket.on('close', () => {
      for (const s of streams) s.destroy();
    });
  });
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/server && npx vitest run tests/routes/logs.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/logs.ts packages/server/tests/routes/logs.test.ts
git commit -m "feat(server): add WebSocket log streaming routes"
```

---

## Task 10: Wire Up Server (Full App Assembly)

**Files:**
- Modify: `packages/server/src/index.ts`

Wire all services and routes together. Add Fastify type declarations for decorators.

- [ ] **Step 1: Create Fastify type augmentation**

Create `packages/server/src/fastify.d.ts`:

```typescript
import type { MonitorService } from './services/monitor.js';
import type { DockerService } from './services/docker.js';
import type { FleetConfigService } from './services/fleet-config.js';
import type { ComposeGenerator } from './services/compose-generator.js';

declare module 'fastify' {
  interface FastifyInstance {
    monitor: MonitorService;
    docker: DockerService;
    fleetConfig: FleetConfigService;
    composeGenerator: ComposeGenerator;
    fleetDir: string;
  }
}
```

- [ ] **Step 2: Update index.ts with full wiring**

```typescript
// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { healthRoutes } from './routes/health.js';
import { fleetRoutes } from './routes/fleet.js';
import { instanceRoutes } from './routes/instances.js';
import { configRoutes } from './routes/config.js';
import { logRoutes } from './routes/logs.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { MonitorService } from './services/monitor.js';
import { ComposeGenerator } from './services/compose-generator.js';

const config = loadConfig();
const app = Fastify({ logger: true });

// Services
const docker = new DockerService();
const fleetConfig = new FleetConfigService(config.fleetDir);
const monitor = new MonitorService(docker, fleetConfig);
const composeGenerator = new ComposeGenerator(config.fleetDir);

// Decorate
app.decorate('docker', docker);
app.decorate('fleetConfig', fleetConfig);
app.decorate('monitor', monitor);
app.decorate('composeGenerator', composeGenerator);
app.decorate('fleetDir', config.fleetDir);

// Plugins
await registerAuth(app, config);
await app.register(fastifyWebsocket);

// Routes — order matters: literal paths before parameterized
await app.register(healthRoutes);
await app.register(configRoutes);   // /api/config/fleet before /:id
await app.register(fleetRoutes);    // /api/fleet + /api/fleet/scale before /:id
await app.register(instanceRoutes); // /api/fleet/:id/*
await app.register(logRoutes);      // /ws/logs/*

// Serve built frontend in production
const webDist = resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  // SPA fallback: serve index.html for non-API routes
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws/')) {
      return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    }
    return reply.sendFile('index.html');
  });
}

// Start
monitor.start();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Claw Fleet Manager running at http://0.0.0.0:${config.port}`);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run all server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/
git commit -m "feat(server): wire up all services, routes, and static file serving"
```

---

## Task 11: Frontend Scaffold + Tailwind + shadcn

**Files:**
- Modify: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`, `packages/web/postcss.config.js`
- Modify: `packages/web/src/main.tsx`, `packages/web/src/App.tsx`
- Create: `packages/web/src/types.ts`

- [ ] **Step 1: Install Tailwind + shadcn + dependencies**

```bash
cd packages/web
npm install @tanstack/react-query zustand recharts @monaco-editor/react
npm install -D tailwindcss @tailwindcss/vite
npx shadcn@latest init --defaults
```

Follow shadcn prompts: pick "default" style, "slate" base color, CSS variables yes.

- [ ] **Step 2: Configure Vite proxy**

Update `packages/web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
```

- [ ] **Step 3: Create shared types**

```typescript
// packages/web/src/types.ts
export interface FleetInstance {
  id: string;
  index: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
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
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
}
```

- [ ] **Step 4: Set up App.tsx with providers**

```tsx
// packages/web/src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shell } from './components/layout/Shell';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 5: Create Zustand store**

```typescript
// packages/web/src/store.ts
import { create } from 'zustand';

type Tab = 'overview' | 'logs' | 'config' | 'metrics';

interface AppState {
  selectedInstanceId: string | null;
  activeTab: Tab;
  selectInstance: (id: string) => void;
  setTab: (tab: Tab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedInstanceId: null,
  activeTab: 'overview',
  selectInstance: (id) => set({ selectedInstanceId: id, activeTab: 'overview' }),
  setTab: (tab) => set({ activeTab: tab }),
}));
```

- [ ] **Step 6: Verify dev server starts**

Run: `cd packages/web && npm run dev`
Expected: Vite dev server starts on :5173 with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): scaffold React app with Tailwind, shadcn, React Query, and Zustand"
```

---

## Task 12: API Client + Hooks

**Files:**
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/api/fleet.ts`
- Create: `packages/web/src/hooks/useFleet.ts`
- Create: `packages/web/src/hooks/useInstanceConfig.ts`
- Create: `packages/web/src/hooks/useFleetConfig.ts`
- Create: `packages/web/src/hooks/useLogs.ts`

- [ ] **Step 1: Create fetch wrapper**

```typescript
// packages/web/src/api/client.ts
export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }

  return res.json();
}
```

- [ ] **Step 2: Create API functions**

```typescript
// packages/web/src/api/fleet.ts
import { apiFetch } from './client';
import type { FleetStatus, FleetConfig, FleetInstance } from '../types';

export const getFleet = () => apiFetch<FleetStatus>('/api/fleet');

export const startInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/start`, { method: 'POST' });

export const stopInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/stop`, { method: 'POST' });

export const restartInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/restart`, { method: 'POST' });

export const revealToken = (id: string) =>
  apiFetch<{ token: string }>(`/api/fleet/${id}/token/reveal`, { method: 'POST' });

export const getInstanceConfig = (id: string) =>
  apiFetch<unknown>(`/api/fleet/${id}/config`);

export const saveInstanceConfig = (id: string, config: unknown) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/${id}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export const getFleetConfig = () => apiFetch<FleetConfig>('/api/config/fleet');

export const saveFleetConfig = (vars: Record<string, string>) =>
  apiFetch<{ ok: boolean }>('/api/config/fleet', {
    method: 'PUT',
    body: JSON.stringify(vars),
  });

export const scaleFleet = (count: number) =>
  apiFetch<{ ok: boolean; fleet: FleetStatus }>('/api/fleet/scale', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
```

- [ ] **Step 3: Create useFleet hook**

```typescript
// packages/web/src/hooks/useFleet.ts
import { useQuery } from '@tanstack/react-query';
import { getFleet } from '../api/fleet';

export function useFleet() {
  return useQuery({
    queryKey: ['fleet'],
    queryFn: getFleet,
    refetchInterval: 5000,
  });
}
```

- [ ] **Step 4: Create useInstanceConfig hook**

```typescript
// packages/web/src/hooks/useInstanceConfig.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getInstanceConfig, saveInstanceConfig } from '../api/fleet';

export function useInstanceConfig(id: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['instanceConfig', id],
    queryFn: () => getInstanceConfig(id!),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: (config: unknown) => saveInstanceConfig(id!, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceConfig', id] });
    },
  });

  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
```

- [ ] **Step 5: Create useFleetConfig hook**

```typescript
// packages/web/src/hooks/useFleetConfig.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFleetConfig, saveFleetConfig } from '../api/fleet';

export function useFleetConfig() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['fleetConfig'],
    queryFn: getFleetConfig,
  });

  const mutation = useMutation({
    mutationFn: saveFleetConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleetConfig'] });
    },
  });

  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
```

- [ ] **Step 6: Create useLogs hook**

```typescript
// packages/web/src/hooks/useLogs.ts
import { useEffect, useRef, useState, useCallback } from 'react';

interface LogEntry {
  id: string;
  line: string;
  ts: number;
}

const MAX_LINES = 1000;

export function useLogs(instanceId: string | null) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);

  const connect = useCallback(() => {
    if (!instanceId) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/logs/${instanceId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retriesRef.current = 0;
    };

    ws.onmessage = (event) => {
      const entry: LogEntry = JSON.parse(event.data);
      setLines((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    };

    ws.onclose = () => {
      setConnected(false);
      if (retriesRef.current < 3) {
        retriesRef.current++;
        setTimeout(connect, Math.pow(2, retriesRef.current) * 1000);
      }
    };

    ws.onerror = () => ws.close();
  }, [instanceId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const clear = useCallback(() => setLines([]), []);

  return { lines, connected, clear };
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api packages/web/src/hooks packages/web/src/store.ts
git commit -m "feat(web): add API client, React Query hooks, and WebSocket log hook"
```

---

## Task 13: Layout Shell + Sidebar

**Files:**
- Create: `packages/web/src/components/layout/Shell.tsx`
- Create: `packages/web/src/components/layout/Sidebar.tsx`
- Create: `packages/web/src/components/layout/SidebarItem.tsx`
- Create: `packages/web/src/components/common/StatusBadge.tsx`

- [ ] **Step 1: Create StatusBadge**

```tsx
// packages/web/src/components/common/StatusBadge.tsx
const statusColors: Record<string, string> = {
  running: 'bg-green-500',
  stopped: 'bg-red-500',
  restarting: 'bg-yellow-500',
  unhealthy: 'bg-orange-500',
  unknown: 'bg-gray-500',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColors[status] ?? statusColors.unknown}`} />
  );
}
```

- [ ] **Step 2: Create SidebarItem**

```tsx
// packages/web/src/components/layout/SidebarItem.tsx
import { StatusBadge } from '../common/StatusBadge';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
  selected: boolean;
  onClick: () => void;
}

export function SidebarItem({ instance, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
      }`}
    >
      <StatusBadge status={instance.status} />
      <span className="font-mono">{instance.id}</span>
      <span className="ml-auto text-xs text-muted-foreground">:{instance.port}</span>
    </button>
  );
}
```

- [ ] **Step 3: Create Sidebar**

```tsx
// packages/web/src/components/layout/Sidebar.tsx
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';

export function Sidebar() {
  const { data } = useFleet();
  const { selectedInstanceId, selectInstance } = useAppStore();

  return (
    <aside className="w-60 border-r bg-card flex flex-col h-full">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold tracking-tight">Claw Fleet</h1>
        {data && (
          <p className="text-xs text-muted-foreground mt-1">
            {data.totalRunning}/{data.instances.length} running
          </p>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <p className="px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Instances
        </p>
        {data?.instances.map((inst) => (
          <SidebarItem
            key={inst.id}
            instance={inst}
            selected={inst.id === selectedInstanceId}
            onClick={() => selectInstance(inst.id)}
          />
        ))}
      </nav>

      <div className="p-2 border-t">
        <button
          onClick={() => useAppStore.setState({ selectedInstanceId: null })}
          className="w-full px-3 py-2 text-sm text-left rounded-md hover:bg-muted"
        >
          Fleet Config
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Create Shell**

```tsx
// packages/web/src/components/layout/Shell.tsx
import { Sidebar } from './Sidebar';
import { useAppStore } from '../../store';
import { InstancePanel } from '../instances/InstancePanel';
import { FleetConfigPanel } from '../config/FleetConfigPanel';

export function Shell() {
  const selectedInstanceId = useAppStore((s) => s.selectedInstanceId);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {selectedInstanceId ? (
          <InstancePanel instanceId={selectedInstanceId} />
        ) : (
          <FleetConfigPanel />
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Create placeholder InstancePanel and FleetConfigPanel**

```tsx
// packages/web/src/components/instances/InstancePanel.tsx
export function InstancePanel({ instanceId }: { instanceId: string }) {
  return <div className="p-6">Instance: {instanceId} (TODO)</div>;
}
```

```tsx
// packages/web/src/components/config/FleetConfigPanel.tsx
export function FleetConfigPanel() {
  return <div className="p-6">Fleet Config (TODO)</div>;
}
```

- [ ] **Step 6: Verify UI renders**

Run: `npm run dev` (from root)
Expected: See sidebar with "Claw Fleet" header and "Fleet Config" link. Instance list will be empty until server is connected.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/
git commit -m "feat(web): add layout shell with sidebar and instance navigation"
```

---

## Task 14: Instance Overview Tab

**Files:**
- Create: `packages/web/src/components/instances/OverviewTab.tsx`
- Create: `packages/web/src/components/common/MaskedValue.tsx`
- Modify: `packages/web/src/components/instances/InstancePanel.tsx`

- [ ] **Step 1: Create MaskedValue component**

```tsx
// packages/web/src/components/common/MaskedValue.tsx
import { useState } from 'react';

interface Props {
  masked: string;
  onReveal: () => Promise<string>;
}

export function MaskedValue({ masked, onReveal }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setLoading(true);
    try {
      const value = await onReveal();
      setRevealed(value);
    } finally {
      setLoading(false);
    }
  };

  const value = revealed ?? masked;

  return (
    <div className="flex items-center gap-2 font-mono text-sm">
      <span className="truncate">{value}</span>
      <button
        onClick={handleReveal}
        className="text-xs text-muted-foreground hover:text-foreground"
        disabled={loading}
      >
        {loading ? '...' : revealed ? 'Hide' : 'Reveal'}
      </button>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Copy
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create OverviewTab**

```tsx
// packages/web/src/components/instances/OverviewTab.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FleetInstance } from '../../types';
import { startInstance, stopInstance, restartInstance, revealToken } from '../../api/fleet';
import { StatusBadge } from '../common/StatusBadge';
import { MaskedValue } from '../common/MaskedValue';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function OverviewTab({ instance }: { instance: FleetInstance }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fleet'] });

  const start = useMutation({ mutationFn: () => startInstance(instance.id), onSuccess: invalidate });
  const stop = useMutation({ mutationFn: () => stopInstance(instance.id), onSuccess: invalidate });
  const restart = useMutation({ mutationFn: () => restartInstance(instance.id), onSuccess: invalidate });

  const cpuPercent = Math.min(instance.cpu, 100);
  const memPercent = instance.memory.limit > 0
    ? (instance.memory.used / instance.memory.limit) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <StatusBadge status={instance.status} />
        <span className="font-semibold capitalize">{instance.status}</span>
        <span className="text-muted-foreground text-sm">port :{instance.port}</span>
        {instance.uptime > 0 && (
          <span className="text-muted-foreground text-sm">uptime {formatUptime(instance.uptime)}</span>
        )}
        <span className="text-muted-foreground text-sm">{instance.image}</span>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        <button
          onClick={() => start.mutate()}
          disabled={instance.status === 'running' || start.isPending}
          className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          Start
        </button>
        <button
          onClick={() => stop.mutate()}
          disabled={instance.status === 'stopped' || stop.isPending}
          className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
        >
          Stop
        </button>
        <button
          onClick={() => restart.mutate()}
          disabled={instance.status === 'stopped' || restart.isPending}
          className="px-3 py-1.5 text-sm rounded-md border hover:bg-muted disabled:opacity-50"
        >
          Restart
        </button>
      </div>

      {/* CPU + Memory */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">CPU</p>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${cpuPercent}%` }} />
          </div>
          <p className="text-sm mt-1">{instance.cpu.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Memory</p>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full" style={{ width: `${memPercent}%` }} />
          </div>
          <p className="text-sm mt-1">
            {formatBytes(instance.memory.used)} / {formatBytes(instance.memory.limit)}
          </p>
        </div>
      </div>

      {/* Gateway token */}
      <div>
        <p className="text-xs text-muted-foreground mb-1">Gateway Token</p>
        <MaskedValue
          masked={instance.token}
          onReveal={async () => {
            const res = await revealToken(instance.id);
            return res.token;
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update InstancePanel with tabs**

```tsx
// packages/web/src/components/instances/InstancePanel.tsx
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { OverviewTab } from './OverviewTab';
import { LogsTab } from './LogsTab';
import { ConfigTab } from './ConfigTab';
import { MetricsTab } from './MetricsTab';

const tabs = ['overview', 'logs', 'config', 'metrics'] as const;

export function InstancePanel({ instanceId }: { instanceId: string }) {
  const { data } = useFleet();
  const { activeTab, setTab } = useAppStore();
  const instance = data?.instances.find((i) => i.id === instanceId);

  if (!instance) {
    return <div className="p-6 text-muted-foreground">Instance not found</div>;
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4 font-mono">{instance.id}</h2>

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab instance={instance} />}
      {activeTab === 'logs' && <LogsTab instanceId={instanceId} />}
      {activeTab === 'config' && <ConfigTab instanceId={instanceId} />}
      {activeTab === 'metrics' && <MetricsTab instance={instance} />}
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder LogsTab, ConfigTab, MetricsTab**

```tsx
// packages/web/src/components/instances/LogsTab.tsx
export function LogsTab({ instanceId }: { instanceId: string }) {
  return <div>Logs for {instanceId} (TODO)</div>;
}
```

```tsx
// packages/web/src/components/instances/ConfigTab.tsx
export function ConfigTab({ instanceId }: { instanceId: string }) {
  return <div>Config for {instanceId} (TODO)</div>;
}
```

```tsx
// packages/web/src/components/instances/MetricsTab.tsx
import type { FleetInstance } from '../../types';
export function MetricsTab({ instance }: { instance: FleetInstance }) {
  return <div>Metrics for {instance.id} (TODO)</div>;
}
```

- [ ] **Step 5: Verify UI renders with tabs**

Run: `npm run dev`
Expected: Clicking an instance in the sidebar shows tabs (Overview, Logs, Config, Metrics) and the Overview tab with status, controls, CPU/mem bars, and token.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add instance panel with overview tab, controls, and masked token"
```

---

## Task 15: Logs Tab

**Files:**
- Modify: `packages/web/src/components/instances/LogsTab.tsx`

- [ ] **Step 1: Implement LogsTab**

```tsx
// packages/web/src/components/instances/LogsTab.tsx
import { useRef, useEffect, useState } from 'react';
import { useLogs } from '../../hooks/useLogs';

export function LogsTab({ instanceId }: { instanceId: string }) {
  const { lines, connected, clear } = useLogs(instanceId);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const filtered = filter
    ? lines.filter((l) => l.line.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const handleDownload = () => {
    const text = filtered.map((l) => l.line).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${instanceId}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <span className={`text-xs ${connected ? 'text-green-500' : 'text-red-500'}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <input
          type="text"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 px-2 py-1 text-sm border rounded-md bg-background"
        />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
        <button onClick={clear} className="text-xs px-2 py-1 border rounded-md hover:bg-muted">
          Clear
        </button>
        <button onClick={handleDownload} className="text-xs px-2 py-1 border rounded-md hover:bg-muted">
          Download
        </button>
      </div>

      {/* Log viewer */}
      <div
        ref={containerRef}
        className="h-[500px] overflow-y-auto bg-black text-green-400 font-mono text-xs p-3 rounded-md"
      >
        {filtered.map((entry, i) => (
          <div key={i} className="whitespace-pre-wrap break-all leading-5">
            {entry.line}
          </div>
        ))}
        {filtered.length === 0 && (
          <span className="text-gray-500">Waiting for logs...</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify logs tab renders**

Run: `npm run dev`, select an instance, click Logs tab.
Expected: See "Disconnected" status (no server running), filter input, auto-scroll toggle, Clear/Download buttons.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/instances/LogsTab.tsx
git commit -m "feat(web): add live log streaming tab with filter, auto-scroll, and download"
```

---

## Task 16: Config Tab (Monaco Editor)

**Files:**
- Modify: `packages/web/src/components/instances/ConfigTab.tsx`

- [ ] **Step 1: Implement ConfigTab**

```tsx
// packages/web/src/components/instances/ConfigTab.tsx
import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

export function ConfigTab({ instanceId }: { instanceId: string }) {
  const { data, isLoading, save, saving } = useInstanceConfig(instanceId);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setValue(JSON.stringify(data, null, 2));
    }
  }, [data]);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    try {
      const parsed = JSON.parse(value);
      await save(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (isLoading) return <div className="text-muted-foreground">Loading config...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {error && <span className="text-sm text-destructive">{error}</span>}
        {saved && <span className="text-sm text-green-500">Saved</span>}
      </div>

      <div className="border rounded-md overflow-hidden">
        <Editor
          height="500px"
          defaultLanguage="json"
          value={value}
          onChange={(v) => setValue(v ?? '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            formatOnPaste: true,
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify config tab renders**

Run: `npm run dev`, select instance, click Config tab.
Expected: Monaco editor with dark theme renders (may show empty or error since no backend).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/instances/ConfigTab.tsx
git commit -m "feat(web): add JSON config editor with Monaco and save functionality"
```

---

## Task 17: Metrics Tab

**Files:**
- Modify: `packages/web/src/components/instances/MetricsTab.tsx`

- [ ] **Step 1: Implement MetricsTab**

```tsx
// packages/web/src/components/instances/MetricsTab.tsx
import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { FleetInstance } from '../../types';

interface DataPoint {
  time: string;
  cpu: number;
  memory: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function MetricsTab({ instance }: { instance: FleetInstance }) {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;

  useEffect(() => {
    const point: DataPoint = {
      time: new Date().toLocaleTimeString(),
      cpu: instance.cpu,
      memory: instance.memory.used / (1024 * 1024), // MB
    };

    setHistory((prev) => {
      const next = [...prev, point];
      // Keep 30 minutes of 5-second intervals = 360 points
      return next.length > 360 ? next.slice(-360) : next;
    });
  }, [instance.cpu, instance.memory.used]);

  return (
    <div className="space-y-6">
      {/* CPU chart */}
      <div>
        <h3 className="text-sm font-medium mb-2">CPU Usage (%)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history}>
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="cpu" stroke="#3b82f6" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Memory chart */}
      <div>
        <h3 className="text-sm font-medium mb-2">Memory Usage (MB)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history}>
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="memory" stroke="#a855f7" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Disk usage */}
      <div>
        <h3 className="text-sm font-medium mb-2">Disk Usage</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 border rounded-md">
            <p className="text-xs text-muted-foreground">Config Volume</p>
            <p className="font-mono">{formatBytes(instance.disk.config)}</p>
          </div>
          <div className="p-3 border rounded-md">
            <p className="text-xs text-muted-foreground">Workspace Volume</p>
            <p className="font-mono">{formatBytes(instance.disk.workspace)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/instances/MetricsTab.tsx
git commit -m "feat(web): add metrics tab with CPU/memory sparklines and disk usage"
```

---

## Task 18: Fleet Config Panel

**Files:**
- Modify: `packages/web/src/components/config/FleetConfigPanel.tsx`
- Create: `packages/web/src/components/common/ConfirmDialog.tsx`

- [ ] **Step 1: Create ConfirmDialog**

```tsx
// packages/web/src/components/common/ConfirmDialog.tsx
interface Props {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="font-semibold text-lg mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4 whitespace-pre-wrap">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-md bg-destructive text-destructive-foreground"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement FleetConfigPanel**

```tsx
// packages/web/src/components/config/FleetConfigPanel.tsx
import { useState, useEffect } from 'react';
import { useFleetConfig } from '../../hooks/useFleetConfig';
import { useFleet } from '../../hooks/useFleet';
import { scaleFleet } from '../../api/fleet';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function FleetConfigPanel() {
  const { data, isLoading, save, saving } = useFleetConfig();
  const { data: fleetData } = useFleet();
  const queryClient = useQueryClient();

  const [scaleCount, setScaleCount] = useState(0);
  const [scaling, setScaling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state for fleet.env fields
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setForm({
        BASE_URL: data.baseUrl,
        MODEL_ID: data.modelId,
        CPU_LIMIT: data.cpuLimit,
        MEM_LIMIT: data.memLimit,
        PORT_STEP: String(data.portStep),
        TZ: data.tz,
      });
      setScaleCount(data.count);
    }
  }, [data]);

  const handleSave = async () => {
    await save(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleScale = async () => {
    const currentCount = fleetData?.instances.length ?? 0;
    if (scaleCount < currentCount) {
      setShowConfirm(true);
      return;
    }
    await doScale();
  };

  const doScale = async () => {
    setShowConfirm(false);
    setScaling(true);
    try {
      await scaleFleet(scaleCount);
      queryClient.invalidateQueries({ queryKey: ['fleet'] });
    } finally {
      setScaling(false);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading config...</div>;

  const currentCount = fleetData?.instances.length ?? 0;
  const removedInstances = scaleCount < currentCount
    ? Array.from({ length: currentCount - scaleCount }, (_, i) => `openclaw-${currentCount - i}`)
    : [];

  const fields = [
    { key: 'BASE_URL', label: 'Base URL' },
    { key: 'MODEL_ID', label: 'Model ID' },
    { key: 'CPU_LIMIT', label: 'CPU Limit' },
    { key: 'MEM_LIMIT', label: 'Memory Limit' },
    { key: 'PORT_STEP', label: 'Port Step' },
    { key: 'TZ', label: 'Timezone' },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-6">Fleet Configuration</h2>

      {/* Config form */}
      <div className="space-y-4 mb-8">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-sm font-medium">{label}</label>
            <input
              type="text"
              value={form[key] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="w-full mt-1 px-3 py-2 border rounded-md bg-background text-sm font-mono"
            />
          </div>
        ))}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          {saved && <span className="text-sm text-green-500">Saved</span>}
        </div>
      </div>

      {/* Scale control */}
      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold mb-3">Scale Fleet</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Currently running {currentCount} instance(s).
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            value={scaleCount}
            onChange={(e) => setScaleCount(parseInt(e.target.value, 10) || 1)}
            className="w-20 px-3 py-2 border rounded-md bg-background text-sm"
          />
          <button
            onClick={handleScale}
            disabled={scaling || scaleCount === currentCount}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {scaling ? 'Scaling...' : 'Apply'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Scale Down Fleet"
        message={`This will stop and remove ${removedInstances.length} instance(s):\n${removedInstances.join(', ')}\n\nVolumes are preserved — you can scale back up to restore them.`}
        onConfirm={doScale}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify fleet config panel renders**

Run: `npm run dev`, click "Fleet Config" in sidebar.
Expected: Form with fields, Save button, Scale section with number input and Apply button.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/config/ packages/web/src/components/common/ConfirmDialog.tsx
git commit -m "feat(web): add fleet config panel with form editing and scale control"
```

---

## Task 19: Production Build + Final Integration

**Files:**
- Modify: `packages/server/src/index.ts` (already has static file serving)
- Verify end-to-end

- [ ] **Step 1: Add .superpowers/ to .gitignore if not present**

Verify `.gitignore` contains `.superpowers/`.

- [ ] **Step 2: Build production**

Run:
```bash
npm run build
```
Expected: Both packages build. `packages/web/dist/` contains the built React app.

- [ ] **Step 3: Create a server.config.json for local testing**

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

Edit `packages/server/server.config.json` to set `fleetDir` to your actual `claw-fleet/openclaw` path.

- [ ] **Step 4: Start production server**

Run:
```bash
cd packages/server && node dist/index.js
```
Expected: Server starts on port 3001, serves API + static files.

- [ ] **Step 5: Open in browser**

Open `http://localhost:3001` in browser.
Expected: Login prompt (Basic Auth), then the fleet manager UI with sidebar showing instances.

- [ ] **Step 6: Test all features manually**

- Click instances in sidebar — verify Overview tab shows status, CPU/mem, controls
- Click Start/Stop/Restart — verify state changes
- Click Logs tab — verify WebSocket connects and streams logs
- Click Config tab — verify Monaco editor loads openclaw.json, save works
- Click Metrics tab — verify charts render
- Click Fleet Config — verify form fields populated, scale control works

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: complete claw-fleet-manager with dashboard, lifecycle, config, logs, and scaling"
```
