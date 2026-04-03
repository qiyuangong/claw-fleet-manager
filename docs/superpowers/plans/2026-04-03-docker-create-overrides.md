# Docker Create Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Docker-only creation settings out of Fleet Config and into the Create Docker Instance dialog as per-instance overrides only.

**Architecture:** Extend the `POST /api/fleet/instances` contract for `kind: 'docker'` with optional request-local Docker overrides, then consume those overrides only during Docker instance creation. Simplify Fleet Config to keep only fleet-level values that still matter globally, including editable `baseDir`, and update the create dialog to expose Docker tuning in an advanced section without mutating global config.

**Tech Stack:** React, TypeScript, React Query, Fastify, Zod, Vitest, Playwright

---

### File Structure

**Server**
- Modify: `packages/server/src/services/backend.ts`
  Purpose: extend `CreateInstanceOpts` with optional Docker-only override fields
- Modify: `packages/server/src/routes/fleet.ts`
  Purpose: validate and pass Docker override fields through `POST /api/fleet/instances`
- Modify: `packages/server/src/services/docker-backend.ts`
  Purpose: apply Docker override fields only to the instance being created
- Modify: `packages/server/src/types.ts`
  Purpose: keep `FleetConfig` aligned with the slimmer Fleet Config UI
- Test: `packages/server/tests/routes/fleet.test.ts`
  Purpose: cover create-instance request validation and payload forwarding
- Test: `packages/server/tests/services/docker-backend.test.ts`
  Purpose: verify per-instance Docker overrides are used during create only

**Web**
- Modify: `packages/web/src/api/fleet.ts`
  Purpose: send optional Docker override fields on Docker create
- Modify: `packages/web/src/types.ts`
  Purpose: remove stale Fleet Config fields that are no longer shown globally
- Modify: `packages/web/src/components/config/FleetConfigPanel.tsx`
  Purpose: remove Docker-only fields plus API key/config/workspace derived fields; keep `baseDir` and timezone
- Modify: `packages/web/src/components/instances/AddInstanceDialog.tsx`
  Purpose: add advanced Docker config controls and submit them only for Docker creates
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`
  Purpose: update labels/help text for Fleet Config and Docker advanced create UI
- Test: `tests/e2e/ui-merge.spec.ts`
  Purpose: verify Fleet Config no longer shows Docker-only fields and Docker create dialog does

### Task 1: Extend the Create-Instance API Contract

**Files:**
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`

- [ ] **Step 1: Write the failing route test for Docker override forwarding**

```ts
it('POST /api/fleet/instances forwards docker-only create overrides', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/fleet/instances',
    payload: {
      kind: 'docker',
      name: 'team-alpha',
      openclawImage: 'openclaw:test',
      cpuLimit: '2',
      memLimit: '8G',
      portStep: 30,
      enableNpmPackages: true,
      apiKey: 'sk-test',
    },
  });

  expect(res.statusCode).toBe(200);
  expect(mockBackend.createInstance).toHaveBeenCalledWith({
    kind: 'docker',
    name: 'team-alpha',
    port: undefined,
    config: undefined,
    openclawImage: 'openclaw:test',
    cpuLimit: '2',
    memLimit: '8G',
    portStep: 30,
    enableNpmPackages: true,
    apiKey: 'sk-test',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @claw-fleet-manager/server -- fleet.test.ts`

Expected: FAIL because the route schema and `CreateInstanceOpts` do not accept the Docker override fields yet.

- [ ] **Step 3: Extend backend and route types minimally**

```ts
export interface CreateInstanceOpts {
  kind?: InstanceMode;
  name?: string;
  port?: number;
  config?: object;
  apiKey?: string;
  openclawImage?: string;
  cpuLimit?: string;
  memLimit?: string;
  portStep?: number;
  enableNpmPackages?: boolean;
}
```

```ts
const createInstanceSchema = z.object({
  kind: z.enum(['docker', 'profile']),
  name: z.string().min(1),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().min(1).optional(),
  openclawImage: z.string().min(1).optional(),
  cpuLimit: z.string().min(1).optional(),
  memLimit: z.string().min(1).optional(),
  portStep: z.number().int().positive().optional(),
  enableNpmPackages: z.boolean().optional(),
});
```

```ts
const instance = await app.backend.createInstance({
  kind,
  name,
  port,
  config: config as object | undefined,
  apiKey: parsed.data.apiKey,
  openclawImage: parsed.data.openclawImage,
  cpuLimit: parsed.data.cpuLimit,
  memLimit: parsed.data.memLimit,
  portStep: parsed.data.portStep,
  enableNpmPackages: parsed.data.enableNpmPackages,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @claw-fleet-manager/server -- fleet.test.ts`

Expected: PASS with the new forwarding assertion green and existing route tests still passing.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/backend.ts packages/server/src/routes/fleet.ts packages/server/tests/routes/fleet.test.ts
git commit -m "feat: accept docker create overrides"
```

### Task 2: Apply Docker Overrides Only During Docker Create

**Files:**
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Write the failing service test for request-local Docker overrides**

```ts
it('createInstance() uses request-local docker overrides without mutating global defaults', async () => {
  mockDocker.listFleetContainers
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ name: 'team-alpha', id: 'abc', state: 'running', index: 1 }]);

  await backend.createInstance({
    kind: 'docker',
    name: 'team-alpha',
    openclawImage: 'openclaw:test',
    cpuLimit: '2',
    memLimit: '8G',
    portStep: 30,
    enableNpmPackages: true,
    apiKey: 'sk-test',
  });

  expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({
    name: 'team-alpha',
    image: 'openclaw:test',
    cpuLimit: '2',
    memLimit: '8G',
    gatewayPort: 18789,
    npmDir: '/tmp/managed/team-alpha/config/.npm',
  }));
  expect(mockFleetConfig.writeFleetConfig).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @claw-fleet-manager/server -- docker-backend.test.ts`

Expected: FAIL because `createInstance()` currently uses only `readFleetConfig()` defaults.

- [ ] **Step 3: Implement minimal per-instance override merge**

```ts
const effective = {
  ...config,
  openclawImage: opts.openclawImage ?? config.openclawImage,
  cpuLimit: opts.cpuLimit ?? config.cpuLimit,
  memLimit: opts.memLimit ?? config.memLimit,
  portStep: opts.portStep ?? config.portStep,
  enableNpmPackages: opts.enableNpmPackages ?? config.enableNpmPackages,
};

const vars = {
  ...this.fleetConfig.readFleetEnvRaw(),
  ...(opts.apiKey ? { API_KEY: opts.apiKey } : {}),
};
```

```ts
provisionDockerInstance({
  instanceId: name,
  index: newIndex,
  portStep: effective.portStep,
  configDir: this.fleetConfig.getDockerConfigDir(name),
  workspaceDir: this.fleetConfig.getDockerWorkspaceDir(name),
  vars,
  token,
  tailscaleConfig: this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
  configOverride: opts.config,
});
```

```ts
await this.docker.createManagedContainer({
  name,
  index: newIndex,
  image: effective.openclawImage,
  gatewayPort: BASE_GW_PORT + (newIndex - 1) * effective.portStep,
  token,
  timezone: config.tz,
  configDir: this.fleetConfig.getDockerConfigDir(name),
  workspaceDir: this.fleetConfig.getDockerWorkspaceDir(name),
  npmDir: effective.enableNpmPackages ? join(this.fleetConfig.getDockerConfigDir(name), '.npm') : undefined,
  cpuLimit: effective.cpuLimit,
  memLimit: effective.memLimit,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @claw-fleet-manager/server -- docker-backend.test.ts`

Expected: PASS, including the new override test and existing Docker backend coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/docker-backend.ts packages/server/tests/services/docker-backend.test.ts
git commit -m "feat: apply docker create overrides per instance"
```

### Task 3: Simplify Fleet Config to Fleet-Level Fields Only

**Files:**
- Modify: `packages/web/src/components/config/FleetConfigPanel.tsx`
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`
- Test: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Write the failing Playwright expectations for the slimmer Fleet Config page**

```ts
await page.getByRole('button', { name: 'Fleet Config' }).click();
await expect(page.getByText('Docker Image')).toHaveCount(0);
await expect(page.getByText('CPU Limit')).toHaveCount(0);
await expect(page.getByText('Memory Limit')).toHaveCount(0);
await expect(page.getByText('Port Step')).toHaveCount(0);
await expect(page.getByText('Enable npm packages')).toHaveCount(0);
await expect(page.getByText('API Key')).toHaveCount(0);
await expect(page.getByText('Config Base')).toHaveCount(0);
await expect(page.getByText('Workspace Base')).toHaveCount(0);
await expect(page.getByText('Base Directory')).toBeVisible();
await expect(page.getByText('Timezone')).toBeVisible();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PLAYWRIGHT_SERVER_COMMAND="npm run dev --workspace @claw-fleet-manager/web -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/ui-merge.spec.ts`

Expected: FAIL because Fleet Config still shows Docker-only fields and API key.

- [ ] **Step 3: Implement the minimal Fleet Config cleanup**

```tsx
const formDefaults = useMemo<Record<string, string>>(() => ({
  BASE_DIR: data?.baseDir ?? '',
  TZ: data?.tz ?? '',
}), [data]);

const fieldLabels: [string, string][] = [
  ['BASE_DIR', t('baseDir')],
  ['TZ', t('timezone')],
];
```

```tsx
<div className="section-grid">
  <div className="metric-card">
    <p className="metric-label">{t('fleetStorageModel')}</p>
    <p className="metric-value mono">{t('baseDirDerivedPaths')}</p>
  </div>
</div>
```

```ts
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
```

The type keeps backend fields available for other consumers, but the panel should render only `baseDir` and `timezone`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PLAYWRIGHT_SERVER_COMMAND="npm run dev --workspace @claw-fleet-manager/web -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/ui-merge.spec.ts`

Expected: PASS with Fleet Config showing only fleet-level fields.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/config/FleetConfigPanel.tsx packages/web/src/types.ts packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts tests/e2e/ui-merge.spec.ts
git commit -m "feat: simplify fleet config to fleet-level fields"
```

### Task 4: Add Advanced Docker Config to Create Docker Instance

**Files:**
- Modify: `packages/web/src/api/fleet.ts`
- Modify: `packages/web/src/components/instances/AddInstanceDialog.tsx`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`
- Test: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Write the failing Playwright test for Docker advanced settings**

```ts
await page.getByRole('button', { name: '+ Add Instance' }).click();
await page.getByRole('button', { name: 'Create Docker Instance' }).click();
await expect(page.getByText('Advanced Docker Config')).toBeVisible();
await expect(page.getByText('Docker Image')).toBeVisible();
await expect(page.getByText('CPU Limit')).toBeVisible();
await expect(page.getByText('Memory Limit')).toBeVisible();
await expect(page.getByText('Port Step')).toBeVisible();
await expect(page.getByText('Enable npm packages')).toBeVisible();
await expect(page.getByText('API Key')).toBeVisible();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PLAYWRIGHT_SERVER_COMMAND="npm run dev --workspace @claw-fleet-manager/web -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/ui-merge.spec.ts`

Expected: FAIL because the Docker create dialog currently exposes only the name field.

- [ ] **Step 3: Implement the advanced Docker section and request payload**

```ts
export interface CreateInstanceOpts {
  kind: 'docker' | 'profile';
  name: string;
  port?: number;
  config?: object;
  apiKey?: string;
  openclawImage?: string;
  cpuLimit?: string;
  memLimit?: string;
  portStep?: number;
  enableNpmPackages?: boolean;
}
```

```tsx
const [showAdvanced, setShowAdvanced] = useState(false);
const [dockerFields, setDockerFields] = useState({
  apiKey: '',
  openclawImage: '',
  cpuLimit: '',
  memLimit: '',
  portStep: '',
  enableNpmPackages: false,
});
```

```tsx
{kind === 'docker' ? (
  <>
    <button className="secondary-button" onClick={() => setShowAdvanced((value) => !value)}>
      {t('advancedDockerConfig')}
    </button>
    {showAdvanced ? (
      <div className="field-grid">
        {/* apiKey, openclawImage, cpuLimit, memLimit, portStep, enableNpmPackages */}
      </div>
    ) : null}
  </>
) : null}
```

```ts
mutationFn: () => createInstance({
  kind,
  name,
  port: kind === 'profile' && port ? parseInt(port, 10) : undefined,
  ...(kind === 'docker'
    ? {
        apiKey: dockerFields.apiKey || undefined,
        openclawImage: dockerFields.openclawImage || undefined,
        cpuLimit: dockerFields.cpuLimit || undefined,
        memLimit: dockerFields.memLimit || undefined,
        portStep: dockerFields.portStep ? parseInt(dockerFields.portStep, 10) : undefined,
        enableNpmPackages: dockerFields.enableNpmPackages,
      }
    : {}),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PLAYWRIGHT_SERVER_COMMAND="npm run dev --workspace @claw-fleet-manager/web -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/ui-merge.spec.ts`

Expected: PASS with the advanced Docker UI visible only in Docker creation.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/fleet.ts packages/web/src/components/instances/AddInstanceDialog.tsx packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts tests/e2e/ui-merge.spec.ts
git commit -m "feat: add advanced docker config to create instance"
```

### Task 5: Full Verification and Deploy Readiness

**Files:**
- Modify: `packages/server/src/types.ts` (only if cleanup is still needed after Tasks 1-4)
- Modify: `packages/web/src/types.ts` (only if cleanup is still needed after Tasks 3-4)
- Test: `packages/server/tests/routes/fleet.test.ts`
- Test: `packages/server/tests/services/docker-backend.test.ts`
- Test: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Run the full server verification**

Run: `npm run test --workspace @claw-fleet-manager/server -- fleet.test.ts instances.test.ts config.test.ts plugins.test.ts profiles.test.ts hybrid-backend.test.ts docker-backend.test.ts profile-backend.test.ts docker-instance-provisioning.test.ts fleet-config.test.ts`

Expected: PASS with `86 passed` or higher if new assertions were added.

- [ ] **Step 2: Run the web build verification**

Run: `npm run build --workspace @claw-fleet-manager/web`

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 3: Run the Playwright regression**

Run: `PLAYWRIGHT_SERVER_COMMAND="npm run dev --workspace @claw-fleet-manager/web -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/ui-merge.spec.ts`

Expected: PASS with `3 passed`.

- [ ] **Step 4: Commit the final integrated change**

```bash
git add packages/server/src/services/backend.ts packages/server/src/routes/fleet.ts packages/server/src/services/docker-backend.ts packages/server/src/types.ts packages/web/src/api/fleet.ts packages/web/src/types.ts packages/web/src/components/config/FleetConfigPanel.tsx packages/web/src/components/instances/AddInstanceDialog.tsx packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts packages/server/tests/routes/fleet.test.ts packages/server/tests/services/docker-backend.test.ts tests/e2e/ui-merge.spec.ts
git commit -m "feat: move docker settings into instance creation"
```
