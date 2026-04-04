# Docker Mode Single-Node Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove compose-era batch scaling, dead MonitorService, and broken disk volume code; make `FleetConfig.count` a computed read-only total; surface Tailscale setup failures as warnings.

**Architecture:** All changes are server-side except the `tailscaleWarning` UI display in `OverviewTab`. Tasks are ordered by risk — removals first (low risk, tests already cover them), then enhancements. Each task is independently committable and leaves tests passing.

**Tech Stack:** TypeScript, Fastify, Vitest, React 19

---

## File Map

| File | Change |
|---|---|
| `packages/server/src/services/backend.ts` | Remove `scaleFleet` from interface |
| `packages/server/src/services/docker-backend.ts` | Remove `scaleFleet`, remove disk override block, add `tailscaleWarning` |
| `packages/server/src/services/profile-backend.ts` | Remove `scaleFleet` |
| `packages/server/src/services/hybrid-backend.ts` | Remove `scaleFleet` |
| `packages/server/src/services/docker.ts` | Remove `getDiskUsage()` |
| `packages/server/src/services/monitor.ts` | **Delete** |
| `packages/server/src/routes/fleet.ts` | Remove scale route + `scaling` flag + `scaleSchema` |
| `packages/server/src/routes/config.ts` | Compute `count` from total live instances |
| `packages/server/src/services/fleet-config.ts` | Remove `countOverride` param + `COUNT` parsing |
| `packages/server/src/types.ts` | Add `tailscaleWarning?: string` to `FleetInstance` |
| `packages/server/src/schemas.ts` | Add `tailscaleWarning` to `fleetInstanceSchema` |
| `packages/server/tests/services/monitor.test.ts` | **Delete** |
| `packages/server/tests/routes/fleet.test.ts` | Remove scale test cases + `scaleFleet` from mocks |
| `packages/server/tests/services/docker-backend.test.ts` | Remove `scaleFleet` + `getDiskUsage` from mock; add `tailscaleWarning` test |
| `packages/server/tests/services/docker.test.ts` | Remove `getDiskUsage` test cases |
| `packages/server/tests/services/hybrid-backend.test.ts` | Remove `scaleFleet` from mocks |
| `packages/web/src/types.ts` | Add `tailscaleWarning?: string` to `FleetInstance` |
| `packages/web/src/components/instances/OverviewTab.tsx` | Display `tailscaleWarning` if present |

---

## Task 1: Remove `scaleFleet` — tests first

**Files:**
- Modify: `packages/server/tests/routes/fleet.test.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`

- [ ] **Step 1: Remove `scaleFleet` from `fleet.test.ts` mock and delete its 3 test cases**

In `packages/server/tests/routes/fleet.test.ts`, make these changes:

Remove `scaleFleet: vi.fn().mockResolvedValue(mockStatus),` from `mockBackend` (line 20). The block becomes:
```ts
const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
  createInstance: vi.fn().mockResolvedValue(mockStatus.instances[0]),
  removeInstance: vi.fn().mockResolvedValue(undefined),
};
```

Also remove `scaleFleet: vi.fn().mockResolvedValue(mockStatus),` from the second mock inside `describe('Fleet routes — hybrid validation'` (around line 181). That block becomes:
```ts
app.decorate('backend', {
  getCachedStatus: vi.fn().mockReturnValue(null),
  createInstance: vi.fn().mockResolvedValue({ id: 'rescue' }),
  removeInstance: vi.fn().mockResolvedValue(undefined),
});
```

Delete these three `it(...)` blocks entirely:
- `it('POST /api/fleet/scale delegates to backend.scaleFleet', ...)`
- `it('POST /api/fleet/scale validates count', ...)`
- `it('POST /api/fleet/scale returns 409 when already scaling', ...)`

- [ ] **Step 2: Remove `scaleFleet` test from `docker-backend.test.ts`**

In `packages/server/tests/services/docker-backend.test.ts`, delete the entire test case:
```ts
it('scaleFleet() removes the highest indexed container name when scaling down', async () => {
  // ... lines 235-256
});
```

- [ ] **Step 3: Remove `scaleFleet` from hybrid-backend mock**

In `packages/server/tests/services/hybrid-backend.test.ts`, remove `scaleFleet: vi.fn(),` from both mock objects (around lines 51 and 70).

- [ ] **Step 4: Run tests — expect failures because the route and methods still exist**

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/services/docker-backend.test.ts tests/services/hybrid-backend.test.ts
```

Expected: tests that reference removed mocks will fail or the removed test cases are simply gone. Remaining tests should pass. Note any unexpected failures.

---

## Task 2: Remove `scaleFleet` — implementation

**Files:**
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/src/services/profile-backend.ts`
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/src/routes/fleet.ts`

- [ ] **Step 1: Remove `scaleFleet` from `DeploymentBackend` interface**

In `packages/server/src/services/backend.ts`, remove line 32:
```ts
// Remove this line:
  scaleFleet(count: number, fleetDir: string): Promise<FleetStatus>;
```

The `// Scaling / management` section becomes:
```ts
  // Scaling / management
  createInstance(opts: CreateInstanceOpts): Promise<FleetInstance>;
  removeInstance(id: string): Promise<void>;
```

- [ ] **Step 2: Remove `scaleFleet` from `DockerBackend`**

In `packages/server/src/services/docker-backend.ts`, delete the entire method (lines 296–320):
```ts
// Delete this entire method:
  async scaleFleet(count: number, _fleetDir: string): Promise<FleetStatus> {
    const currentContainers = await this.docker.listFleetContainers();
    const currentCount = currentContainers.length;

    if (count === currentCount) {
      return this.refresh();
    }

    if (count > currentCount) {
      for (let next = currentCount + 1; next <= count; next += 1) {
        await this.createInstance({ name: `openclaw-${next}` });
      }
      return this.refresh();
    }

    const containersByDescendingIndex = currentContainers
      .filter((container) => container.index !== undefined)
      .sort((left, right) => (right.index ?? 0) - (left.index ?? 0));

    for (const container of containersByDescendingIndex.slice(0, currentCount - count)) {
      await this.removeInstance(container.name);
    }

    return this.refresh();
  }
```

- [ ] **Step 3: Remove `scaleFleet` from `ProfileBackend`**

In `packages/server/src/services/profile-backend.ts`, delete the method:
```ts
// Delete this entire method:
  async scaleFleet(_count: number, _fleetDir: string): Promise<FleetStatus> {
    throw new Error('scaleFleet not supported in profile mode — use createInstance/removeInstance');
  }
```

- [ ] **Step 4: Remove `scaleFleet` from `HybridBackend`**

In `packages/server/src/services/hybrid-backend.ts`, delete the method (lines 86–89):
```ts
// Delete this entire method:
  async scaleFleet(count: number, fleetDir: string): Promise<FleetStatus> {
    await this.dockerBackend.scaleFleet(count, fleetDir);
    return this.refresh();
  }
```

- [ ] **Step 5: Remove scale route from `fleet.ts`**

In `packages/server/src/routes/fleet.ts`:

Remove line 10: `const scaleSchema = z.object({ count: z.number().int().positive() });`

Remove line 23: `let scaling = false;`

Delete the entire `app.post('/api/fleet/scale', ...)` handler (lines 47–97).

The file should jump from the `app.get('/api/fleet', ...)` handler directly to `app.post('/api/fleet/instances', ...)`.

- [ ] **Step 6: Run tests — all should pass**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass, no TypeScript errors about missing `scaleFleet`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/backend.ts \
  packages/server/src/services/docker-backend.ts \
  packages/server/src/services/profile-backend.ts \
  packages/server/src/services/hybrid-backend.ts \
  packages/server/src/routes/fleet.ts \
  packages/server/tests/routes/fleet.test.ts \
  packages/server/tests/services/docker-backend.test.ts \
  packages/server/tests/services/hybrid-backend.test.ts
git commit -m "refactor: remove batch scaleFleet — single-node manages instances individually"
```

---

## Task 3: Delete `MonitorService`

**Files:**
- Delete: `packages/server/src/services/monitor.ts`
- Delete: `packages/server/tests/services/monitor.test.ts`

- [ ] **Step 1: Verify `monitor.ts` has no imports**

```bash
grep -r "from.*monitor" packages/server/src --include="*.ts"
```

Expected: no output. If any imports exist, remove them before proceeding.

- [ ] **Step 2: Delete both files**

```bash
rm packages/server/src/services/monitor.ts
rm packages/server/tests/services/monitor.test.ts
```

- [ ] **Step 3: Run tests**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete MonitorService — superseded by DockerBackend polling"
```

---

## Task 4: Remove `getDiskUsage` and the disk-override block

**Files:**
- Modify: `packages/server/src/services/docker.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/tests/services/docker.test.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Remove `getDiskUsage` from `DockerService`**

In `packages/server/src/services/docker.ts`, delete the entire method:
```ts
// Delete this method:
  async getDiskUsage(): Promise<Record<string, number>> {
    const df = await this.docker.df() as any;
    const result: Record<string, number> = {};
    for (const volume of df.Volumes ?? []) {
      result[volume.Name] = volume.UsageData?.Size ?? 0;
    }
    return result;
  }
```

- [ ] **Step 2: Remove the disk-override block from `DockerBackend.refresh()`**

In `packages/server/src/services/docker-backend.ts`, delete lines 104–121 — the entire try/catch block:
```ts
// Delete this block:
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
```

- [ ] **Step 3: Remove `getDiskUsage` from `mockDocker` in `docker-backend.test.ts`**

In `packages/server/tests/services/docker-backend.test.ts`, remove line 18 from the mock:
```ts
// Remove this line from mockDocker:
  getDiskUsage: vi.fn().mockResolvedValue({}),
```

- [ ] **Step 4: Remove `getDiskUsage` test cases from `docker.test.ts`**

In `packages/server/tests/services/docker.test.ts`, delete these three test cases (approximately lines 141–162):
```ts
// Delete all three of these:
it('getDiskUsage returns volume sizes keyed by name', ...)
it('getDiskUsage returns empty record when no volumes', ...)
it('getDiskUsage defaults missing UsageData to 0', ...)
```

- [ ] **Step 5: Run tests**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/docker.ts \
  packages/server/src/services/docker-backend.ts \
  packages/server/tests/services/docker.test.ts \
  packages/server/tests/services/docker-backend.test.ts
git commit -m "refactor: remove getDiskUsage — containers use bind mounts, not Docker volumes"
```

---

## Task 5: `FleetConfig.count` → computed read-only total

**Files:**
- Modify: `packages/server/src/services/fleet-config.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/tests/routes/config.test.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Update existing tests and add count test in `config.test.ts`**

In `packages/server/tests/routes/config.test.ts`:

**Update the existing assertion** in `'GET /api/config/fleet returns masked fleet config'` — change:
```ts
expect(mockFleetConfig.readFleetConfig).toHaveBeenCalledWith(2);
```
to:
```ts
expect(mockFleetConfig.readFleetConfig).toHaveBeenCalledWith();
```

**Update the `beforeEach` mock** to return `count: 0` (the placeholder value `readFleetConfig` will return after the change):
```ts
mockFleetConfig.readFleetConfig.mockImplementation(() => ({
  baseUrl: 'https://api.example.com',
  apiKey: 'sk-***123',
  modelId: 'gpt-4',
  baseDir: '/tmp/managed',
  count: 0,   // placeholder — overridden at route level
  cpuLimit: '4',
  memLimit: '8G',
  portStep: 20,
  configBase: '/tmp/instances',
  workspaceBase: '/tmp/workspaces',
  tz: 'UTC',
  openclawImage: 'openclaw:local',
  enableNpmPackages: false,
}));
```

**Add a new test** for the total-count behavior:
```ts
it('GET /api/config/fleet returns count = total live instances across all backends', async () => {
  mockBackend.getCachedStatus.mockReturnValue({
    mode: 'hybrid',
    instances: [
      { id: 'openclaw-1', mode: 'docker' },
      { id: 'dev', mode: 'profile' },
      { id: 'staging', mode: 'profile' },
    ],
    totalRunning: 2,
    updatedAt: Date.now(),
  });

  const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });

  expect(res.statusCode).toBe(200);
  expect(res.json().count).toBe(3);
});
```

- [ ] **Step 2: Run test to verify the new test fails and the updated assertion passes**

```bash
cd packages/server && npx vitest run tests/routes/config.test.ts
```

Expected: the new `count = 3` test FAILS (count currently comes from `readFleetConfig(liveCount)` with docker-only count), existing tests pass.

- [ ] **Step 3: Remove `countOverride` from `FleetConfigService.readFleetConfig()`**

In `packages/server/src/services/fleet-config.ts`, change the method signature and remove COUNT parsing:

```ts
  readFleetConfig(): FleetConfig {
    const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));

    return {
      baseUrl: vars.BASE_URL ?? '',
      apiKey: vars.API_KEY ? FleetConfigService.maskToken(vars.API_KEY) : '',
      modelId: vars.MODEL_ID ?? '',
      baseDir: this.baseDir,
      count: 0,   // placeholder — overridden in config route
      cpuLimit: vars.CPU_LIMIT ?? '4',
      memLimit: vars.MEM_LIMIT ?? '4G',
      portStep: parseInt(vars.PORT_STEP ?? '20', 10),
      configBase: this.getConfigBase(),
      workspaceBase: this.getWorkspaceBase(),
      tz: vars.TZ ?? 'Asia/Shanghai',
      openclawImage: vars.OPENCLAW_IMAGE ?? 'openclaw:local',
      enableNpmPackages: vars.ENABLE_NPM_PACKAGES === 'true',
    };
  }
```

- [ ] **Step 4: Update `config.ts` GET to compute count from all backends**

In `packages/server/src/routes/config.ts`, update the `GET /api/config/fleet` handler:

```ts
  }, async () => {
    const cached = app.backend.getCachedStatus();
    const liveCount = cached?.instances.length ?? 0;
    const config = app.fleetConfig.readFleetConfig();
    return { ...config, count: liveCount };
  });
```

- [ ] **Step 5: Update `mockFleetConfig` in `docker-backend.test.ts` to drop `count`**

In `packages/server/tests/services/docker-backend.test.ts`, remove `count: 3,` from the `readFleetConfig` mock return value:
```ts
  readFleetConfig: vi.fn().mockReturnValue({
    baseDir: '/tmp/managed',
    portStep: 20,
    configBase: '/tmp/cfg',
    workspaceBase: '/tmp/ws',
    openclawImage: 'openclaw:local',
    tz: 'Asia/Shanghai',
    enableNpmPackages: false,
    cpuLimit: '4',
    memLimit: '4G',
  }),
```

- [ ] **Step 6: Run tests**

```bash
cd packages/server && npx vitest run
```

Expected: all pass, including the new count test.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/fleet-config.ts \
  packages/server/src/routes/config.ts \
  packages/server/tests/routes/config.test.ts \
  packages/server/tests/services/docker-backend.test.ts
git commit -m "refactor: make FleetConfig.count a computed read-only total across all backends"
```

---

## Task 6: Add `tailscaleWarning` — server

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/schemas.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Write a failing test for `tailscaleWarning` on setup failure**

In `packages/server/tests/services/docker-backend.test.ts`, add a new `describe` block at the end for Tailscale warning behavior:

```ts
describe('DockerBackend — tailscaleWarning', () => {
  it('createInstance() sets tailscaleWarning on the returned instance when tailscale.setup() throws', async () => {
    const mockTailscale = {
      allocatePorts: vi.fn().mockReturnValue(new Map()),
      setup: vi.fn().mockRejectedValue(new Error('tailscale daemon unavailable')),
      teardown: vi.fn().mockResolvedValue(undefined),
      syncAll: vi.fn().mockResolvedValue(undefined),
      getUrl: vi.fn().mockReturnValue(undefined),
    };

    const backendWithTs = new DockerBackend(
      mockDocker as any,
      mockFleetConfig as any,
      '/tmp/fleet',
      mockTailscale as any,
      'my-host.ts.net',
    );

    mockDocker.listFleetContainers.mockResolvedValue([]);
    mockDocker.getContainerStats.mockResolvedValue({ cpu: 0, memory: { used: 0, limit: 0 } });
    mockDocker.inspectContainer.mockResolvedValue({ status: 'running', health: 'healthy', image: 'openclaw:local', uptime: 0 });

    const instance = await backendWithTs.createInstance({ name: 'openclaw-1' });

    expect(instance.tailscaleWarning).toMatch(/tailscale setup failed/i);
  });

  it('createInstance() does not set tailscaleWarning when tailscale.setup() succeeds', async () => {
    const mockTailscale = {
      allocatePorts: vi.fn().mockReturnValue(new Map()),
      setup: vi.fn().mockResolvedValue(undefined),
      teardown: vi.fn().mockResolvedValue(undefined),
      syncAll: vi.fn().mockResolvedValue(undefined),
      getUrl: vi.fn().mockReturnValue('https://openclaw-1.my-host.ts.net'),
    };

    const backendWithTs = new DockerBackend(
      mockDocker as any,
      mockFleetConfig as any,
      '/tmp/fleet',
      mockTailscale as any,
      'my-host.ts.net',
    );

    mockDocker.listFleetContainers.mockResolvedValue([]);
    mockDocker.getContainerStats.mockResolvedValue({ cpu: 0, memory: { used: 0, limit: 0 } });
    mockDocker.inspectContainer.mockResolvedValue({ status: 'running', health: 'healthy', image: 'openclaw:local', uptime: 0 });

    const instance = await backendWithTs.createInstance({ name: 'openclaw-1' });

    expect(instance.tailscaleWarning).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: FAIL — `tailscaleWarning` property does not exist on `FleetInstance`.

- [ ] **Step 3: Add `tailscaleWarning` to `FleetInstance` in `types.ts`**

In `packages/server/src/types.ts`, add the optional field to `FleetInstance`:

```ts
export interface FleetInstance {
  id: string;
  mode: InstanceMode;
  index?: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;
  tailscaleWarning?: string;   // set when Tailscale setup failed during createInstance
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  profile?: string;
  pid?: number;
}
```

- [ ] **Step 4: Add `tailscaleWarning` to `fleetInstanceSchema` in `schemas.ts`**

In `packages/server/src/schemas.ts`, add the field inside `fleetInstanceSchema.properties` after `tailscaleUrl`:

```ts
    tailscaleUrl: { type: 'string' },
    tailscaleWarning: { type: 'string' },
```

(Do not add it to `required`.)

- [ ] **Step 5: Update `DockerBackend.createInstance()` to capture Tailscale warning**

In `packages/server/src/services/docker-backend.ts`, replace the Tailscale setup block near line 208–215:

```ts
    let tailscaleWarning: string | undefined;
    if (this.tailscale) {
      const gwPort = BASE_GW_PORT + (newIndex - 1) * resolvedPortStep;
      try {
        await this.tailscale.setup(newIndex, gwPort);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tailscaleWarning = `Tailscale setup failed: ${message}`;
        this.log?.error({ err, newIndex }, 'Tailscale setup failed for new instance');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((i) => i.id === name);
    if (!instance) throw new Error(`Instance "${name}" not found after creation`);
    return tailscaleWarning ? { ...instance, tailscaleWarning } : instance;
```

- [ ] **Step 6: Run tests**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: all pass including the two new Tailscale warning tests.

- [ ] **Step 7: Run full test suite**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/types.ts \
  packages/server/src/schemas.ts \
  packages/server/src/services/docker-backend.ts \
  packages/server/tests/services/docker-backend.test.ts
git commit -m "feat: surface Tailscale setup failures as tailscaleWarning on createInstance response"
```

---

## Task 7: Add `tailscaleWarning` — web UI

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/components/instances/OverviewTab.tsx`

- [ ] **Step 1: Add `tailscaleWarning` to web `FleetInstance` type**

In `packages/web/src/types.ts`, add the optional field to `FleetInstance`:

```ts
export interface FleetInstance {
  id: string;
  mode: 'docker' | 'profile';
  index?: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;
  tailscaleWarning?: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  profile?: string;
  pid?: number;
}
```

- [ ] **Step 2: Display warning in `OverviewTab`**

In `packages/web/src/components/instances/OverviewTab.tsx`, add the warning banner just before the closing `</div>` of the component (after the gateway token section):

```tsx
      {instance.tailscaleWarning ? (
        <section className="panel-card">
          <p className="metric-label" style={{ color: 'var(--color-warning, #b45309)' }}>
            Tailscale Warning
          </p>
          <p className="muted" style={{ margin: 0, wordBreak: 'break-word' }}>
            {instance.tailscaleWarning}
          </p>
        </section>
      ) : null}
    </div>
```

The full closing sequence of the component's return should look like:

```tsx
      <section className="panel-card">
        <p className="metric-label">{t('gatewayToken')}</p>
        <MaskedValue
          masked={instance.token}
          onReveal={async () => (await revealToken(instance.id)).token}
        />
      </section>

      {instance.tailscaleWarning ? (
        <section className="panel-card">
          <p className="metric-label" style={{ color: 'var(--color-warning, #b45309)' }}>
            Tailscale Warning
          </p>
          <p className="muted" style={{ margin: 0, wordBreak: 'break-word' }}>
            {instance.tailscaleWarning}
          </p>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Build web package to confirm no TypeScript errors**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/types.ts \
  packages/web/src/components/instances/OverviewTab.tsx
git commit -m "feat: display tailscaleWarning in OverviewTab when Tailscale setup failed"
```

---

## Final verification

- [ ] **Run full test suite one last time**

```bash
cd packages/server && npx vitest run
```

Expected: all pass, no orphaned references to `scaleFleet`, `getDiskUsage`, or `MonitorService`.

- [ ] **Check for any remaining references to removed APIs**

```bash
grep -r "scaleFleet\|getDiskUsage\|MonitorService\|/api/fleet/scale" packages/server/src packages/web/src --include="*.ts" --include="*.tsx"
```

Expected: no output.
