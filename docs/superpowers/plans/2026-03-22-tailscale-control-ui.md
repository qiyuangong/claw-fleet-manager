# Tailscale Control UI Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose each openclaw instance via Tailscale Serve HTTPS so the Control UI is accessible from any device on the tailnet, not just localhost.

**Architecture:** A new `TailscaleService` manages `tailscale serve` configs per instance (one HTTPS port per instance). `ComposeGenerator` writes an `openclaw.json` config to each instance's config dir enabling Tailscale identity auth. The fleet manager wires these together at scale time; `ControlUiTab` uses the Tailscale URL when present.

**Tech Stack:** Node.js `execFile` for `tailscale` CLI, Vitest for tests, React for frontend.

---

## File Map

**Create:**
- `packages/server/src/services/tailscale.ts` — TailscaleService class
- `packages/server/tests/services/tailscale.test.ts` — TailscaleService tests

**Modify:**
- `packages/server/src/types.ts` — add `tailscaleUrl?` to FleetInstance, `tailscale?` to ServerConfig
- `packages/server/src/config.ts` — add `tailscale` to Zod schema
- `packages/server/server.config.example.json` — add commented tailscale example
- `packages/server/src/services/compose-generator.ts` — write `openclaw.json` when tailscaleConfig provided
- `packages/server/src/services/monitor.ts` — accept optional TailscaleService, populate tailscaleUrl
- `packages/server/src/routes/fleet.ts` — call TailscaleService on scale up/down
- `packages/server/src/fastify.d.ts` — add `tailscale: TailscaleService | null`
- `packages/server/src/index.ts` — preflight check, instantiate TailscaleService, syncAll on start
- `packages/web/src/types.ts` — add `tailscaleUrl?` to FleetInstance
- `packages/web/src/components/instances/ControlUiTab.tsx` — use tailscaleUrl when present

**Update tests:**
- `packages/server/tests/services/compose-generator.test.ts` — add tailscale config test cases
- `packages/server/tests/services/monitor.test.ts` — add tailscaleUrl test case
- `packages/server/tests/routes/fleet.test.ts` — update generate() call assertion

---

## Task 1: Types and Config Schema

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/server.config.example.json`
- Modify: `packages/web/src/types.ts`

- [ ] **Step 1: Add `tailscaleUrl?` to server FleetInstance and `tailscale?` to ServerConfig**

In `packages/server/src/types.ts`:

```typescript
export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  tailscale?: { hostname: string };
}

export interface FleetInstance {
  id: string;
  index: number;
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
}
```

- [ ] **Step 2: Add tailscale to Zod schema in `packages/server/src/config.ts`**

```typescript
const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
  tailscale: z.object({ hostname: z.string().min(1) }).optional(),
});
```

- [ ] **Step 3: Update `packages/server/server.config.example.json`**

```json
{
  "port": 3001,
  "auth": { "username": "admin", "password": "changeme" },
  "fleetDir": "/path/to/claw-fleet/openclaw",
  "tailscale": { "hostname": "machine.tailnet.ts.net" }
}
```

- [ ] **Step 4: Add `tailscaleUrl?` to web FleetInstance in `packages/web/src/types.ts`**

```typescript
export interface FleetInstance {
  id: string;
  index: number;
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
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/config.ts \
        packages/server/server.config.example.json packages/web/src/types.ts
git commit -m "feat: add tailscale types and config schema"
```

---

## Task 2: TailscaleService — Core Methods

**Files:**
- Create: `packages/server/src/services/tailscale.ts`
- Create: `packages/server/tests/services/tailscale.test.ts`

The service wraps the `tailscale` CLI. Ports are allocated as `BASE_TS_PORT (8800) + (index - 1)` (fixed step of 1). Port assignments are persisted in `{fleetDir}/tailscale-ports.json` with string keys and number values (e.g. `{ "1": 8800, "2": 8801 }`).

- [ ] **Step 1: Write failing tests for `setup()`, `teardown()`, `getUrl()`, and `allocatePorts()`**

Create `packages/server/tests/services/tailscale.test.ts`:

```typescript
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TailscaleService } from '../../src/services/tailscale.js';

// Mock execFile so tests don't run real CLI commands
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));
vi.mock('node:util', () => ({
  promisify: (fn: any) => fn,
}));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

const SERVE_STATUS_JSON = JSON.stringify({
  Web: {
    'machine.tailnet.ts.net:8800': {
      Handlers: { '/': { Proxy: 'http://127.0.0.1:18789' } },
    },
  },
});

describe('TailscaleService', () => {
  let dir: string;
  let svc: TailscaleService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tailscale-test-'));
    svc = new TailscaleService(dir, 'machine.tailnet.ts.net');
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('allocatePorts()', () => {
    it('assigns BASE_TS_PORT + (index - 1) to new indices', () => {
      const map = svc.allocatePorts([1, 2, 3]);
      expect(map.get(1)).toBe(8800);
      expect(map.get(2)).toBe(8801);
      expect(map.get(3)).toBe(8802);
    });

    it('persists port assignments to tailscale-ports.json', () => {
      svc.allocatePorts([1, 2]);
      const file = JSON.parse(readFileSync(join(dir, 'tailscale-ports.json'), 'utf-8'));
      expect(file).toEqual({ '1': 8800, '2': 8801 });
    });

    it('does not overwrite ports already assigned', () => {
      svc.allocatePorts([1]);
      svc.allocatePorts([1, 2]);
      const map = svc.allocatePorts([1, 2]);
      expect(map.get(1)).toBe(8800); // unchanged
      expect(map.get(2)).toBe(8801);
    });
  });

  describe('getUrl()', () => {
    it('returns undefined before allocation', () => {
      expect(svc.getUrl(1)).toBeUndefined();
    });

    it('returns URL after allocatePorts', () => {
      svc.allocatePorts([1]);
      expect(svc.getUrl(1)).toBe('https://machine.tailnet.ts.net:8800');
    });
  });

  describe('setup()', () => {
    it('runs tailscale serve and returns the HTTPS URL on success', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)      // serve add
        .mockResolvedValueOnce({ stdout: SERVE_STATUS_JSON, stderr: '' } as any); // status

      const url = await svc.setup(1, 18789);
      expect(url).toBe('https://machine.tailnet.ts.net:8800');
      expect(mockExecFile).toHaveBeenCalledWith(
        'tailscale',
        ['serve', '--bg', '--https=8800', 'localhost:18789'],
        expect.any(Object),
      );
    });

    it('throws if status verification fails after setup', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
        .mockResolvedValueOnce({ stdout: '{}', stderr: '' } as any); // empty status

      await expect(svc.setup(1, 18789)).rejects.toThrow();
    });
  });

  describe('teardown()', () => {
    it('runs tailscale serve off without --bg flag', async () => {
      svc.allocatePorts([1]);
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' } as any);

      await svc.teardown(1);
      expect(mockExecFile).toHaveBeenCalledWith(
        'tailscale',
        ['serve', '--https=8800', 'off'],
        expect.any(Object),
      );
    });

    it('does not throw if teardown CLI fails', async () => {
      svc.allocatePorts([1]);
      mockExecFile.mockRejectedValueOnce(new Error('tailscale error'));
      await expect(svc.teardown(1)).resolves.toBeUndefined();
    });

    it('is a no-op for unknown index', async () => {
      await expect(svc.teardown(99)).resolves.toBeUndefined();
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/server && npx vitest run tests/services/tailscale.test.ts
```
Expected: FAIL — `TailscaleService` does not exist yet.

- [ ] **Step 3: Implement `TailscaleService`**

Create `packages/server/src/services/tailscale.ts`:

```typescript
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const BASE_TS_PORT = 8800;

export class TailscaleService {
  private portMap = new Map<number, number>(); // index → tsPort
  private portFile: string;

  constructor(
    private fleetDir: string,
    private hostname: string,
  ) {
    this.portFile = join(fleetDir, 'tailscale-ports.json');
    this.loadPortFile();
  }

  private loadPortFile(): void {
    if (!existsSync(this.portFile)) return;
    const raw = JSON.parse(readFileSync(this.portFile, 'utf-8')) as Record<string, number>;
    for (const [k, v] of Object.entries(raw)) {
      this.portMap.set(parseInt(k, 10), v);
    }
  }

  private savePortFile(): void {
    const obj: Record<string, number> = {};
    for (const [k, v] of this.portMap) obj[String(k)] = v;
    writeFileSync(this.portFile, JSON.stringify(obj, null, 2));
  }

  /** Allocate Tailscale ports for the given indices (no-op if already assigned). */
  allocatePorts(indices: number[]): Map<number, number> {
    for (const index of indices) {
      if (!this.portMap.has(index)) {
        this.portMap.set(index, BASE_TS_PORT + (index - 1));
      }
    }
    this.savePortFile();
    return new Map(this.portMap);
  }

  /** Returns the Tailscale HTTPS URL for an index, or undefined if not allocated. */
  getUrl(index: number): string | undefined {
    const tsPort = this.portMap.get(index);
    return tsPort !== undefined ? `https://${this.hostname}:${tsPort}` : undefined;
  }

  /** Runs tailscale serve --bg --https={tsPort} localhost:{gwPort}. Verifies and returns URL. */
  async setup(index: number, gwPort: number): Promise<string> {
    if (!this.portMap.has(index)) {
      this.allocatePorts([index]);
    }
    const tsPort = this.portMap.get(index)!;

    await execFileAsync('tailscale', ['serve', '--bg', `--https=${tsPort}`, `localhost:${gwPort}`]);

    // Verify the serve rule is active
    const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json']);
    const status = JSON.parse(stdout) as Record<string, any>;
    const key = `${this.hostname}:${tsPort}`;
    if (!status?.Web?.[key]?.Handlers) {
      // Roll back
      await execFileAsync('tailscale', ['serve', `--https=${tsPort}`, 'off']).catch(() => {});
      throw new Error(`Tailscale serve verification failed for instance ${index} (port ${tsPort})`);
    }

    return `https://${this.hostname}:${tsPort}`;
  }

  /** Removes the tailscale serve rule for an index. Errors are logged, never thrown. */
  async teardown(index: number): Promise<void> {
    const tsPort = this.portMap.get(index);
    if (tsPort === undefined) return;
    try {
      await execFileAsync('tailscale', ['serve', `--https=${tsPort}`, 'off']);
    } catch (err) {
      console.error(`[TailscaleService] teardown failed for index ${index}:`, err);
    }
  }

  /** On startup: verifies existing serve rules and re-runs setup() for any missing ones. */
  async syncAll(instances: { index: number; gwPort: number }[]): Promise<void> {
    let statusJson: Record<string, any> = {};
    try {
      const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json']);
      statusJson = JSON.parse(stdout);
    } catch {
      console.warn('[TailscaleService] Could not read serve status; will re-setup all entries.');
    }

    // Remove port file entries for indices no longer in the fleet
    const activeIndices = new Set(instances.map((i) => i.index));
    for (const index of this.portMap.keys()) {
      if (!activeIndices.has(index)) this.portMap.delete(index);
    }
    this.savePortFile();

    // Re-setup any missing serve rules
    for (const { index, gwPort } of instances) {
      const tsPort = this.portMap.get(index);
      if (tsPort === undefined) continue;
      const key = `${this.hostname}:${tsPort}`;
      if (!statusJson?.Web?.[key]?.Handlers) {
        try {
          await this.setup(index, gwPort);
        } catch (err) {
          console.error(`[TailscaleService] syncAll re-setup failed for index ${index}:`, err);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd packages/server && npx vitest run tests/services/tailscale.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/tailscale.ts \
        packages/server/tests/services/tailscale.test.ts
git commit -m "feat: add TailscaleService for per-instance serve management"
```

---

## Task 3: ComposeGenerator — Write openclaw.json

**Files:**
- Modify: `packages/server/src/services/compose-generator.ts`
- Modify: `packages/server/tests/services/compose-generator.test.ts`

- [ ] **Step 1: Add failing tests**

Add to `packages/server/tests/services/compose-generator.test.ts`:

```typescript
import { existsSync } from 'node:fs';

// Add inside describe('ComposeGenerator', () => { ... }):

it('writes openclaw.json with tailscale auth config for new instances', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(2, {
    hostname: 'machine.tailnet.ts.net',
    portMap: new Map([[1, 8800], [2, 8801]]),
  });

  const config1 = JSON.parse(
    readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
  );
  expect(config1.gateway.auth.allowTailscale).toBe(true);
  expect(config1.gateway.controlUi.allowInsecureAuth).toBe(true);
  expect(config1.allowedOrigins).toContain('https://machine.tailnet.ts.net:8800');

  const config2 = JSON.parse(
    readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
  );
  expect(config2.allowedOrigins).toContain('https://machine.tailnet.ts.net:8801');
});

it('does not write openclaw.json when tailscaleConfig is absent', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(2);
  expect(existsSync(join(dir, 'instances', '1', 'openclaw.json'))).toBe(false);
});

it('does not overwrite existing openclaw.json on re-scale', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(1, {
    hostname: 'machine.tailnet.ts.net',
    portMap: new Map([[1, 8800]]),
  });
  // Mutate the file to simulate user customisation
  writeFileSync(join(dir, 'instances', '1', 'openclaw.json'), '{"custom":true}');
  gen.generate(2, {
    hostname: 'machine.tailnet.ts.net',
    portMap: new Map([[1, 8800], [2, 8801]]),
  });
  const content = JSON.parse(readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'));
  expect(content.custom).toBe(true); // not overwritten
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```
Expected: 3 new tests FAIL.

- [ ] **Step 3: Update `ComposeGenerator.generate()` signature and implementation**

In `packages/server/src/services/compose-generator.ts`, change the signature and add openclaw.json write:

```typescript
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
// ... other imports unchanged

interface TailscaleConfig {
  hostname: string;
  portMap: Map<number, number>;
}

export class ComposeGenerator {
  // ... constructor unchanged

  generate(count: number, tailscaleConfig?: TailscaleConfig): void {
    // ... all existing logic unchanged until the directory creation loop:

    for (let i = 1; i <= count; i += 1) {
      tokens[i] = existingTokens[i] ?? randomBytes(32).toString('hex');
      if (i <= count) {
        mkdirSync(join(configBase, String(i)), { recursive: true });
        mkdirSync(join(workspaceBase, String(i)), { recursive: true });

        // Write openclaw.json for new instances only (skip if file exists)
        if (tailscaleConfig) {
          const configFile = join(configBase, String(i), 'openclaw.json');
          if (!existsSync(configFile)) {
            const tsPort = tailscaleConfig.portMap.get(i);
            const openclawConfig = {
              gateway: {
                auth: { allowTailscale: true },
                controlUi: { allowInsecureAuth: true },
              },
              allowedOrigins: [`https://${tailscaleConfig.hostname}:${tsPort}`],
            };
            writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2));
          }
        }
      }
    }

    // ... rest of existing logic unchanged
  }
}
```

- [ ] **Step 4: Run all compose-generator tests**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/compose-generator.ts \
        packages/server/tests/services/compose-generator.test.ts
git commit -m "feat: write openclaw.json with tailscale auth config on scale"
```

---

## Task 4: MonitorService — Populate tailscaleUrl

**Files:**
- Modify: `packages/server/src/services/monitor.ts`
- Modify: `packages/server/tests/services/monitor.test.ts`

- [ ] **Step 1: Add failing test**

Add to `packages/server/tests/services/monitor.test.ts`:

```typescript
it('populates tailscaleUrl from TailscaleService when provided', async () => {
  const mockTailscale = {
    getUrl: vi.fn().mockReturnValue('https://machine.tailnet.ts.net:8800'),
  };
  const svcWithTs = new MonitorService(
    mockDocker as any,
    mockFleetConfig as any,
    mockTailscale as any,
  );
  const status = await svcWithTs.refresh();
  expect(status.instances[0].tailscaleUrl).toBe('https://machine.tailnet.ts.net:8800');
});

it('omits tailscaleUrl when TailscaleService is null', async () => {
  const status = await svc.refresh(); // svc has no TailscaleService
  expect(status.instances[0].tailscaleUrl).toBeUndefined();
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd packages/server && npx vitest run tests/services/monitor.test.ts
```
Expected: 2 new tests FAIL.

- [ ] **Step 3: Update `MonitorService` constructor and `refresh()`**

In `packages/server/src/services/monitor.ts`:

```typescript
import type { TailscaleService } from './tailscale.js';

export class MonitorService {
  // ...

  constructor(
    private docker: DockerService,
    private fleetConfig: FleetConfigService,
    private tailscale: TailscaleService | null = null,
  ) {}

  // In refresh(), inside the containers.map() callback, add to the returned object:
  // tailscaleUrl: this.tailscale?.getUrl(index),
```

In the `return { ... }` block inside `containers.map()`:

```typescript
return {
  id: container.name,
  index,
  status: this.mapStatus(inspection.status),
  port: BASE_GW_PORT + (index - 1) * config.portStep,
  token: FleetConfigService.maskToken(tokens[index] ?? ''),
  tailscaleUrl: this.tailscale?.getUrl(index),
  uptime: inspection.uptime,
  cpu: stats.cpu,
  memory: stats.memory,
  disk: {
    config: this.getDirectorySize(join(configBase, String(index))),
    workspace: this.getDirectorySize(join(workspaceBase, String(index))),
  },
  health: this.mapHealth(inspection.health),
  image: inspection.image,
};
```

- [ ] **Step 4: Run all monitor tests**

```bash
cd packages/server && npx vitest run tests/services/monitor.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/monitor.ts \
        packages/server/tests/services/monitor.test.ts
git commit -m "feat: populate tailscaleUrl in MonitorService from TailscaleService"
```

---

## Task 5: Fleet Route — Tailscale Lifecycle on Scale

**Files:**
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/src/fastify.d.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`

- [ ] **Step 1: Update fleet.test.ts — fix generate() assertion and add tailscale mock**

In `packages/server/tests/routes/fleet.test.ts`:

```typescript
// Replace:
const mockComposeGen = { generate: vi.fn() };
// With:
const mockComposeGen = { generate: vi.fn() };
const mockTailscale = {
  allocatePorts: vi.fn().mockReturnValue(new Map()),
  teardown: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn().mockResolvedValue('https://machine.tailnet.ts.net:8800'),
};

// In beforeAll, add decoration:
app.decorate('tailscale', mockTailscale);

// Replace the existing scale assertion:
expect(mockComposeGen.generate).toHaveBeenCalledWith(3, expect.anything());
// (tailscaleConfig arg is passed through, exact value not asserted here)
```

- [ ] **Step 2: Run fleet tests to confirm the assertion change fails first**

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts
```
Expected: FAIL on `generate` call assertion.

- [ ] **Step 3: Update `fastify.d.ts`**

```typescript
import type { TailscaleService } from './services/tailscale.js';

declare module 'fastify' {
  interface FastifyInstance {
    monitor: MonitorService;
    docker: DockerService;
    fleetConfig: FleetConfigService;
    composeGenerator: ComposeGenerator;
    fleetDir: string;
    proxyAuth: string;
    tailscale: TailscaleService | null;
  }
}
```

- [ ] **Step 4: Update `fleet.ts` scale route**

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const scaleSchema = z.object({ count: z.number().int().positive() });
const BASE_GW_PORT = 18789;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async () => {
    const status = app.monitor.getStatus();
    return status ?? { instances: [], totalRunning: 0, updatedAt: Date.now() };
  });

  app.post('/api/fleet/scale', async (request, reply) => {
    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'count must be a positive integer',
        code: 'INVALID_COUNT',
      });
    }

    const { count } = parsed.data;
    const currentContainers = await app.docker.listFleetContainers();
    const currentIndices = currentContainers.map((c) =>
      parseInt(c.name.replace('openclaw-', ''), 10),
    );
    const newIndices = Array.from({ length: count }, (_, i) => i + 1).filter(
      (i) => !currentIndices.includes(i),
    );
    const removedIndices = currentIndices.filter((i) => i > count);

    // Stop removed containers
    for (const container of currentContainers.filter((c) => {
      const idx = parseInt(c.name.replace('openclaw-', ''), 10);
      return idx > count;
    })) {
      try {
        await app.docker.stopContainer(container.name);
      } catch {
        // already stopped
      }
    }

    // Teardown Tailscale for removed instances (non-fatal)
    for (const idx of removedIndices) {
      await app.tailscale?.teardown(idx);
    }

    // Allocate Tailscale ports for new instances before generating compose
    const portMap = app.tailscale?.allocatePorts(newIndices) ?? new Map<number, number>();
    const tailscaleHostname = (app as any).tailscaleHostname as string | undefined;

    app.composeGenerator.generate(
      count,
      tailscaleHostname ? { hostname: tailscaleHostname, portMap } : undefined,
    );

    try {
      await execFileAsync('docker', ['compose', 'up', '-d'], { cwd: app.fleetDir });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'COMPOSE_FAILED' });
    }

    // Setup Tailscale serve for new instances (non-fatal per instance)
    for (const idx of newIndices) {
      const gwPort = BASE_GW_PORT + (idx - 1);
      try {
        await app.tailscale?.setup(idx, gwPort);
      } catch (err) {
        app.log.error({ err, idx }, 'Tailscale setup failed for instance');
      }
    }

    const status = await app.monitor.refresh();
    return { ok: true, fleet: status };
  });
}
```

Note: `tailscaleHostname` is stored as a separate decoration (added in Task 6) to avoid passing config through app.tailscale.

- [ ] **Step 5: Run fleet tests**

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts
```
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/routes/fleet.ts \
        packages/server/src/fastify.d.ts \
        packages/server/tests/routes/fleet.test.ts
git commit -m "feat: integrate TailscaleService into fleet scale route"
```

---

## Task 6: Wire Up in index.ts

**Files:**
- Modify: `packages/server/src/index.ts`

No new tests needed — this is wiring/startup code exercised by existing integration tests.

- [ ] **Step 1: Update `index.ts`**

```typescript
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { configRoutes } from './routes/config.js';
import { fleetRoutes } from './routes/fleet.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { logRoutes } from './routes/logs.js';
import { proxyRoutes } from './routes/proxy.js';
import { ComposeGenerator } from './services/compose-generator.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { MonitorService } from './services/monitor.js';
import { TailscaleService } from './services/tailscale.js';

const execFileAsync = promisify(execFile);
const config = loadConfig();

// Tailscale preflight check
let tailscale: TailscaleService | null = null;
if (config.tailscale) {
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

const app = Fastify({ logger: true });

const docker = new DockerService();
const fleetConfig = new FleetConfigService(config.fleetDir);
const monitor = new MonitorService(docker, fleetConfig, tailscale);
const composeGenerator = new ComposeGenerator(config.fleetDir);

app.decorate('docker', docker);
app.decorate('fleetConfig', fleetConfig);
app.decorate('monitor', monitor);
app.decorate('composeGenerator', composeGenerator);
app.decorate('fleetDir', config.fleetDir);
app.decorate('tailscale', tailscale);
app.decorate('tailscaleHostname', config.tailscale?.hostname ?? null);
app.decorate('proxyAuth', Buffer.from(
  `${config.auth.username}:${config.auth.password}`,
  'utf-8',
).toString('base64'));

await registerAuth(app, config);
await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(configRoutes);
await app.register(fleetRoutes);
await app.register(instanceRoutes);
await app.register(logRoutes);
await app.register(proxyRoutes);

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

app.server.on('connection', (socket) => {
  socket.on('error', () => {});
});

// Sync Tailscale serve rules with current fleet state on startup
if (tailscale) {
  const containers = await docker.listFleetContainers().catch(() => []);
  const instances = containers.map((c) => {
    const index = parseInt(c.name.replace('openclaw-', ''), 10);
    const portStep = parseInt(fleetConfig.readFleetEnvRaw().PORT_STEP ?? '20', 10);
    const gwPort = 18789 + (index - 1) * portStep;
    return { index, gwPort };
  });
  await tailscale.syncAll(instances);
}

// Also add tailscaleHostname to fastify.d.ts
monitor.start();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Claw Fleet Manager running at http://0.0.0.0:${config.port}`);
```

- [ ] **Step 2: Add `tailscaleHostname` to `fastify.d.ts`**

```typescript
declare module 'fastify' {
  interface FastifyInstance {
    monitor: MonitorService;
    docker: DockerService;
    fleetConfig: FleetConfigService;
    composeGenerator: ComposeGenerator;
    fleetDir: string;
    proxyAuth: string;
    tailscale: TailscaleService | null;
    tailscaleHostname: string | null;
  }
}
```

- [ ] **Step 3: Run the full server test suite**

```bash
cd packages/server && npx vitest run
```
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/fastify.d.ts
git commit -m "feat: wire TailscaleService into server startup with preflight check"
```

---

## Task 7: ControlUiTab — Frontend Changes

**Files:**
- Modify: `packages/web/src/components/instances/ControlUiTab.tsx`

- [ ] **Step 1: Update `ControlUiTab.tsx`**

```typescript
import { useState } from 'react';
import { revealToken } from '../../api/fleet';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
}

export function ControlUiTab({ instance }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRemote = window.location.hostname !== 'localhost' &&
                   window.location.hostname !== '127.0.0.1';
  const baseUrl = instance.tailscaleUrl
    ? `${instance.tailscaleUrl}/`
    : `http://${window.location.hostname}:${instance.port}/`;
  const isDisabled = !instance.tailscaleUrl && isRemote;

  const buildLaunchUrl = async (): Promise<string> => {
    const { token } = await revealToken(instance.id);
    return `${baseUrl}#token=${token}`;
  };

  const handleOpen = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const url = await buildLaunchUrl();
      window.open(url, '_blank', 'noreferrer');
      setStatus('Opened Control UI in a new tab.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to open Control UI');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const url = await buildLaunchUrl();
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Launch URL copied to clipboard.');
      } catch {
        window.prompt('Copy launch URL:', url);
        setStatus('Launch URL prepared. Copy it from the prompt.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to build launch URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>Control UI</h3>
          <p className="muted">Open the gateway Control UI with a one-time token.</p>
        </div>
      </div>

      <div className="section-grid">
        {!isDisabled && (
          <div className="metric-card">
            <p className="metric-label">Gateway URL</p>
            <p className="metric-value mono">{baseUrl}</p>
          </div>
        )}
        <div className="metric-card">
          <p className="metric-label">Instance</p>
          <p className="metric-value mono">{instance.id}</p>
        </div>
      </div>

      {isDisabled && (
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          Tailscale is not configured — Control UI is only accessible on localhost.
        </p>
      )}

      <div className="action-row" style={{ marginTop: '1rem' }}>
        <button
          className="primary-button"
          onClick={() => void handleOpen()}
          disabled={loading || isDisabled}
          title={isDisabled ? 'Tailscale not configured — Control UI is only accessible on localhost' : undefined}
        >
          {loading ? 'Preparing...' : 'Open Control UI'}
        </button>
        <button
          className="secondary-button"
          onClick={() => void handleCopy()}
          disabled={loading || isDisabled}
        >
          Copy launch URL
        </button>
      </div>

      {status ? <p className="token-status success-text">{status}</p> : null}
      {error ? <p className="token-status error-text">{error}</p> : null}
    </section>
  );
}
```

- [ ] **Step 2: Build the web package to confirm no TypeScript errors**

```bash
cd packages/web && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/instances/ControlUiTab.tsx \
        packages/web/src/types.ts
git commit -m "feat: use tailscaleUrl in ControlUiTab, disable button when remote without Tailscale"
```

---

## Task 8: Full Test Run and Smoke Test

- [ ] **Step 1: Run the complete server test suite**

```bash
cd packages/server && npx vitest run
```
Expected: All tests PASS.

- [ ] **Step 2: Build both packages**

```bash
npm run build
```
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Manual smoke test (if Tailscale available)**

1. Add `"tailscale": { "hostname": "your-machine.tailnet.ts.net" }` to `server.config.json`
2. Start server: `npm run dev`
3. Open the web UI from a remote tailnet device
4. Scale to 1 instance — confirm `tailscale serve status` shows port 8800
5. Open Control UI from remote — confirm it opens the Tailscale HTTPS URL

- [ ] **Step 4: Final commit**

```bash
git add -p  # stage any remaining changes
git commit -m "feat: tailscale serve integration for control ui remote access"
```
