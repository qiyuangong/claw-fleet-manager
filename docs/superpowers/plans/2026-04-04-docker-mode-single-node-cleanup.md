# Docker Mode Single-Node Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale compose-era Docker fleet scaling and trim the fleet-config contract down to fields that still make sense after moving Docker management to per-instance create/remove flows.

**Architecture:** Delete the `/api/fleet/scale` API and the backend `scaleFleet()` contract, then simplify `FleetConfig` so the server no longer computes or returns synthetic `count`, `configBase`, or `workspaceBase` values. Keep Docker create-time defaults intact where they are still used by the create dialog, but stop presenting deprecated fleet-wide scaling state through the public API.

**Tech Stack:** Node.js/TypeScript server (Fastify, Vitest), React/TypeScript web client (shared API/types only), OpenAPI schema tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/services/backend.ts` | Modify | Remove obsolete `scaleFleet()` backend contract |
| `packages/server/src/services/docker-backend.ts` | Modify | Drop Docker scale implementation |
| `packages/server/src/services/hybrid-backend.ts` | Modify | Remove hybrid delegation for scale |
| `packages/server/src/services/profile-backend.ts` | Modify | Remove no-op scale method |
| `packages/server/src/services/fleet-config.ts` | Modify | Stop synthesizing deprecated count/path fields |
| `packages/server/src/routes/fleet.ts` | Modify | Remove `/api/fleet/scale` route and validation state |
| `packages/server/src/routes/config.ts` | Modify | Stop passing live docker count into `readFleetConfig()` |
| `packages/server/src/schemas.ts` | Modify | Trim `fleetConfigSchema`; remove obsolete scale docs |
| `packages/server/src/types.ts` | Modify | Remove deprecated `FleetConfig` fields |
| `packages/web/src/types.ts` | Modify | Remove deprecated `FleetConfig` fields from client type |
| `packages/server/tests/routes/fleet.test.ts` | Modify | Remove scale route tests |
| `packages/server/tests/routes/config.test.ts` | Modify | Assert trimmed fleet-config payload |
| `packages/server/tests/routes/documentation.test.ts` | Modify | Assert scale route is no longer published |
| `packages/server/tests/services/fleet-config.test.ts` | Modify | Assert deprecated fields are no longer returned |
| `packages/server/tests/services/docker-backend.test.ts` | Modify | Remove scaleFleet tests |
| `packages/server/tests/services/hybrid-backend.test.ts` | Modify | Keep backend mock shape aligned with contract |

---

### Task 1: Remove deprecated fields from `FleetConfig`

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/web/src/types.ts`
- Modify: `packages/server/src/services/fleet-config.ts`
- Modify: `packages/server/src/schemas.ts`
- Test: `packages/server/tests/services/fleet-config.test.ts`
- Test: `packages/server/tests/routes/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/services/fleet-config.test.ts`, replace the old assertions for `count`, `configBase`, and `workspaceBase` with:

```ts
it('does not expose deprecated fleet sizing or derived path fields', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), [
    'COUNT=3',
    'PORT_STEP=20',
  ].join('\n'));

  const config = svc.readFleetConfig();

  expect(config).not.toHaveProperty('count');
  expect(config).not.toHaveProperty('configBase');
  expect(config).not.toHaveProperty('workspaceBase');
});
```

In `packages/server/tests/routes/config.test.ts`, replace the numeric field assertions with:

```ts
it('GET /api/config/fleet omits deprecated sizing/path fields', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });

  expect(res.statusCode).toBe(200);
  expect(res.json()).not.toHaveProperty('count');
  expect(res.json()).not.toHaveProperty('configBase');
  expect(res.json()).not.toHaveProperty('workspaceBase');
  expect(res.json().portStep).toBeTypeOf('number');
  expect(res.json().enableNpmPackages).toBeTypeOf('boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/server && npx vitest run tests/services/fleet-config.test.ts tests/routes/config.test.ts
```

Expected: failures because the current `FleetConfig` object still includes `count`, `configBase`, and `workspaceBase`.

- [ ] **Step 3: Remove deprecated `FleetConfig` fields from shared types**

Update `packages/server/src/types.ts` and `packages/web/src/types.ts` so `FleetConfig` becomes:

```ts
export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}
```

- [ ] **Step 4: Stop returning deprecated fields from `fleet-config.ts` and schema**

In `packages/server/src/services/fleet-config.ts`, change `readFleetConfig()` to:

```ts
readFleetConfig(): FleetConfig {
  const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));

  return {
    baseUrl: vars.BASE_URL ?? '',
    apiKey: vars.API_KEY ? FleetConfigService.maskToken(vars.API_KEY) : '',
    modelId: vars.MODEL_ID ?? '',
    baseDir: this.baseDir,
    cpuLimit: vars.CPU_LIMIT ?? '4',
    memLimit: vars.MEM_LIMIT ?? '4G',
    portStep: parseInt(vars.PORT_STEP ?? '20', 10),
    tz: vars.TZ ?? 'Asia/Shanghai',
    openclawImage: vars.OPENCLAW_IMAGE ?? 'openclaw:local',
    enableNpmPackages: vars.ENABLE_NPM_PACKAGES === 'true',
  };
}
```

In `packages/server/src/schemas.ts`, remove `count`, `configBase`, and `workspaceBase` from `fleetConfigSchema.properties` and `required`.

- [ ] **Step 5: Stop passing count overrides through config routes**

In `packages/server/src/routes/config.ts`, replace:

```ts
const cached = app.backend.getCachedStatus();
const liveCount = cached?.instances.filter((instance) => instance.mode === 'docker').length;
return app.fleetConfig.readFleetConfig(liveCount);
```

with:

```ts
return app.fleetConfig.readFleetConfig();
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
cd packages/server && npx vitest run tests/services/fleet-config.test.ts tests/routes/config.test.ts
```

Expected: both files pass with the trimmed `FleetConfig` contract.

---

### Task 2: Remove the obsolete Docker fleet scaling API and backend contract

**Files:**
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/src/services/profile-backend.ts`
- Modify: `packages/server/src/routes/fleet.ts`
- Test: `packages/server/tests/routes/fleet.test.ts`
- Test: `packages/server/tests/services/docker-backend.test.ts`
- Test: `packages/server/tests/services/hybrid-backend.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/routes/fleet.test.ts`, replace the scale route assertions with:

```ts
it('POST /api/fleet/scale is no longer exposed', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
  expect(res.statusCode).toBe(404);
});
```

In `packages/server/tests/services/docker-backend.test.ts`, delete the `scaleFleet()` test block and add this compile-level expectation near the create/remove tests:

```ts
it('createInstance() still fills the next available slot without a fleet-scale helper', async () => {
  mockDocker.listFleetContainers
    .mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'a', state: 'running', index: 1 },
      { name: 'openclaw-3', id: 'b', state: 'running', index: 3 },
    ])
    .mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'a', state: 'running', index: 1 },
      { name: 'openclaw-3', id: 'b', state: 'running', index: 3 },
      { name: 'team-alpha', id: 'c', state: 'running', index: 2 },
    ]);

  await backend.createInstance({ name: 'team-alpha' });

  expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({ index: 2 }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/services/docker-backend.test.ts tests/services/hybrid-backend.test.ts
```

Expected: route test fails because `/api/fleet/scale` still exists.

- [ ] **Step 3: Remove the scale contract from backend interfaces**

In `packages/server/src/services/backend.ts`, delete:

```ts
scaleFleet(count: number, fleetDir: string): Promise<FleetStatus>;
```

Delete the corresponding `scaleFleet()` methods from:
- `packages/server/src/services/docker-backend.ts`
- `packages/server/src/services/hybrid-backend.ts`
- `packages/server/src/services/profile-backend.ts`

Also remove any now-unused imports or parameters left behind.

- [ ] **Step 4: Delete the `/api/fleet/scale` route**

In `packages/server/src/routes/fleet.ts`, remove:
- `scaleSchema`
- module-level `scaling` flag
- the entire `app.post('/api/fleet/scale', ...)` block

Keep `GET /api/fleet`, `POST /api/fleet/instances`, and `DELETE /api/fleet/instances/:id` unchanged.

- [ ] **Step 5: Align tests and mocks with the slimmer backend contract**

Remove `scaleFleet` from backend mocks in:
- `packages/server/tests/services/hybrid-backend.test.ts`
- `packages/server/tests/routes/fleet.test.ts`

Delete the old scale-route test cases from `packages/server/tests/routes/fleet.test.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/services/docker-backend.test.ts tests/services/hybrid-backend.test.ts
```

Expected: all targeted tests pass and there are no remaining references to `scaleFleet`.

---

### Task 3: Remove stale OpenAPI exposure for scale and verify the final contract

**Files:**
- Modify: `packages/server/tests/routes/documentation.test.ts`
- Test: `packages/server/tests/routes/documentation.test.ts`
- Test: `packages/server/tests/routes/config.test.ts`
- Test: `packages/server/tests/routes/fleet.test.ts`

- [ ] **Step 1: Write the failing documentation test**

In `packages/server/tests/routes/documentation.test.ts`, replace the scale assertions with:

```ts
it('does not publish the removed fleet scale endpoint', async () => {
  const res = await app.inject({ method: 'GET', url: '/documentation/json' });
  const spec = res.json();

  expect(spec.paths['/api/fleet/scale']).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd packages/server && npx vitest run tests/routes/documentation.test.ts
```

Expected: failure because the generated OpenAPI spec still includes `/api/fleet/scale`.

- [ ] **Step 3: Keep only the surviving public contract**

Ensure no remaining server schema/route registration publishes scale or the removed config properties. The expected remaining config response shape is:

```ts
{
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}
```

- [ ] **Step 4: Run the final targeted verification**

Run:

```bash
cd packages/server && npx vitest run \
  tests/services/fleet-config.test.ts \
  tests/services/docker-backend.test.ts \
  tests/services/hybrid-backend.test.ts \
  tests/routes/config.test.ts \
  tests/routes/fleet.test.ts \
  tests/routes/documentation.test.ts
```

Expected: all targeted tests pass, `/api/fleet/scale` is absent from OpenAPI, and fleet config no longer exposes deprecated sizing/path fields.
