# Hermes Gateway Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gateway-first Hermes support across profile and Docker deployments, rendered in the same fleet UI as OpenClaw, without reusing OpenClaw-only control assumptions.

**Architecture:** Keep the current one-fleet control plane, but add a new `runtime` dimension alongside `mode`. Preserve existing OpenClaw backends in place, add Hermes-specific backends, and evolve the current hybrid router into a runtime+mode router with capability-aware fleet instances so the web UI can show shared actions and hide OpenClaw-only tabs for Hermes.

**Tech Stack:** Fastify, TypeScript, Vitest, React 19, React Query, Zustand

---

## File Structure

### Server files to modify

- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/schemas.ts`
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/routes/instances.ts`

### Server files to create

- Create: `packages/server/src/services/hermes-profile-backend.ts`
- Create: `packages/server/src/services/hermes-docker-backend.ts`
- Create: `packages/server/tests/services/hermes-profile-backend.test.ts`
- Create: `packages/server/tests/services/hermes-docker-backend.test.ts`

### Existing server tests to update

- Modify: `packages/server/tests/services/hybrid-backend.test.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`
- Modify: `packages/server/tests/routes/config.test.ts`
- Modify: `packages/server/tests/routes/sessions.test.ts`
- Modify: `packages/server/tests/routes/instances.test.ts`

### Web files to modify

- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/api/fleet.ts`
- Modify: `packages/web/src/components/instances/AddInstanceDialog.tsx`
- Modify: `packages/web/src/components/instances/InstanceManagementPanel.tsx`
- Modify: `packages/web/src/components/instances/InstancePanel.tsx`
- Modify: `packages/web/src/components/instances/OverviewTab.tsx`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`

### Web tests to create or update

- Create: `packages/web/src/components/instances/AddInstanceDialog.test.tsx`
- Create: `packages/web/src/components/instances/InstancePanel.test.tsx`

## Task 1: Add Runtime-Aware Fleet Contracts

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/schemas.ts`
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/api/fleet.ts`

- [ ] **Step 1: Write failing server tests for runtime-aware creation and fleet payloads**

```ts
it('POST /api/fleet/instances passes runtime and kind through to backend.createInstance', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/fleet/instances',
    payload: { runtime: 'hermes', kind: 'profile', name: 'research-bot' },
  });

  expect(res.statusCode).toBe(200);
  expect(mockBackend.createInstance).toHaveBeenCalledWith({
    runtime: 'hermes',
    kind: 'profile',
    name: 'research-bot',
    port: undefined,
    config: undefined,
  });
});

it('GET /api/fleet includes runtime and runtimeCapabilities on each instance', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/fleet' });
  const [instance] = res.json().instances;
  expect(instance.runtime).toBe('openclaw');
  expect(instance.runtimeCapabilities.logs).toBe(true);
});
```

- [ ] **Step 2: Run the targeted server tests and confirm the new contract is missing**

Run: `cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/services/hybrid-backend.test.ts`

Expected: FAIL with body/schema/assertion mismatches around missing `runtime` and `runtimeCapabilities`.

- [ ] **Step 3: Update shared instance and backend contracts**

```ts
export type InstanceRuntime = 'openclaw' | 'hermes';
export type InstanceMode = 'docker' | 'profile';

export interface RuntimeCapabilities {
  configEditor: boolean;
  logs: boolean;
  rename: boolean;
  delete: boolean;
  proxyAccess: boolean;
  sessions: boolean;
  plugins: boolean;
  runtimeAdmin: boolean;
}

export interface FleetInstance {
  id: string;
  runtime: InstanceRuntime;
  mode: InstanceMode;
  runtimeCapabilities: RuntimeCapabilities;
  // existing fields preserved
}

export interface CreateInstanceOpts {
  runtime: InstanceRuntime;
  kind: InstanceMode;
  name?: string;
  port?: number;
  config?: object;
  apiKey?: string;
  image?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  portStep?: number;
  enableNpmPackages?: boolean;
}
```

- [ ] **Step 4: Update Fastify schemas and route validation to require `runtime`**

```ts
const createInstanceSchema = z.object({
  runtime: z.enum(['openclaw', 'hermes']),
  kind: z.enum(['docker', 'profile']),
  name: z.string().min(1),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().min(1).optional(),
  image: z.string().min(1).optional(),
  cpuLimit: z.string().min(1).optional(),
  memoryLimit: z.string().min(1).optional(),
  portStep: z.number().int().positive().optional(),
  enableNpmPackages: z.boolean().optional(),
});
```

- [ ] **Step 5: Mirror the new type shape in the web client**

```ts
export interface FleetInstance {
  id: string;
  runtime: 'openclaw' | 'hermes';
  mode: 'docker' | 'profile';
  runtimeCapabilities: {
    configEditor: boolean;
    logs: boolean;
    rename: boolean;
    delete: boolean;
    proxyAccess: boolean;
    sessions: boolean;
    plugins: boolean;
    runtimeAdmin: boolean;
  };
  // existing fields preserved
}

export interface CreateInstanceOpts {
  runtime: 'openclaw' | 'hermes';
  kind: 'docker' | 'profile';
  name: string;
  // existing optional fields preserved
}
```

- [ ] **Step 6: Re-run the targeted tests**

Run: `cd packages/server && npx vitest run tests/routes/fleet.test.ts tests/services/hybrid-backend.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/services/backend.ts packages/server/src/schemas.ts packages/server/src/routes/fleet.ts packages/server/tests/routes/fleet.test.ts packages/server/tests/services/hybrid-backend.test.ts packages/web/src/types.ts packages/web/src/api/fleet.ts
git commit -m "refactor: add runtime-aware fleet contracts"
```

## Task 2: Implement Hermes Profile Backend

**Files:**
- Create: `packages/server/src/services/hermes-profile-backend.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/types.ts`
- Create: `packages/server/tests/services/hermes-profile-backend.test.ts`

- [ ] **Step 1: Write failing Hermes profile backend tests**

```ts
it('createInstance creates a Hermes profile instance with hermes runtime metadata', async () => {
  const instance = await backend.createInstance({ runtime: 'hermes', kind: 'profile', name: 'research-bot' });

  expect(instance.runtime).toBe('hermes');
  expect(instance.mode).toBe('profile');
  expect(instance.profile).toBe('research-bot');
  expect(instance.runtimeCapabilities.proxyAccess).toBe(false);
  expect(instance.runtimeCapabilities.logs).toBe(true);
});

it('readInstanceConfig reads config.yaml from the profile home', async () => {
  const config = await backend.readInstanceConfig('research-bot');
  expect(config).toEqual(expect.objectContaining({ agent: expect.any(Object) }));
});
```

- [ ] **Step 2: Run the new backend tests and confirm the backend does not exist**

Run: `cd packages/server && npx vitest run tests/services/hermes-profile-backend.test.ts`

Expected: FAIL because `hermes-profile-backend.ts` is missing and the test cannot import it.

- [ ] **Step 3: Add Hermes profile config to server config types**

```ts
const hermesProfilesSchema = z.object({
  binary: z.string().default('hermes'),
  baseHomeDir: z.string().default(join(homedir(), '.hermes', 'profiles')),
  stopTimeoutMs: z.number().int().positive().default(10000),
});
```

- [ ] **Step 4: Implement a profile-scoped Hermes backend**

```ts
export class HermesProfileBackend implements DeploymentBackend {
  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const name = opts.name ?? '';
    const homeDir = join(this.cfg.baseHomeDir, name);
    await mkdir(homeDir, { recursive: true });
    await this.ensureHermesProfileScaffold(homeDir);

    return {
      id: name,
      runtime: 'hermes',
      mode: 'profile',
      status: 'stopped',
      port: 0,
      token: 'hidden',
      uptime: 0,
      cpu: 0,
      memory: { used: 0, limit: 0 },
      disk: { config: 0, workspace: 0 },
      health: 'none',
      image: 'hermes',
      profile: name,
      pid: undefined,
      runtimeCapabilities: {
        configEditor: true,
        logs: true,
        rename: true,
        delete: true,
        proxyAccess: false,
        sessions: false,
        plugins: false,
        runtimeAdmin: true,
      },
    };
  }
}
```

- [ ] **Step 5: Use Hermes-native files for config and logs**

```ts
private getProfileHome(name: string): string {
  return join(this.cfg.baseHomeDir, name);
}

async readInstanceConfig(id: string): Promise<object> {
  const path = join(this.getProfileHome(id), 'config.yaml');
  return yaml.load(readFileSync(path, 'utf-8')) as object;
}

async writeInstanceConfig(id: string, config: object): Promise<void> {
  const path = join(this.getProfileHome(id), 'config.yaml');
  writeFileSync(path, yaml.dump(config));
}
```

- [ ] **Step 6: Re-run the Hermes profile tests**

Run: `cd packages/server && npx vitest run tests/services/hermes-profile-backend.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/hermes-profile-backend.ts packages/server/src/config.ts packages/server/src/types.ts packages/server/tests/services/hermes-profile-backend.test.ts
git commit -m "feat: add hermes profile backend"
```

## Task 3: Implement Hermes Docker Backend

**Files:**
- Create: `packages/server/src/services/hermes-docker-backend.ts`
- Modify: `packages/server/src/services/docker.ts`
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/tests/services/hermes-docker-backend.test.ts`

- [ ] **Step 1: Write failing Hermes Docker backend tests**

```ts
it('createInstance creates a Hermes container with persistent HERMES_HOME', async () => {
  await backend.createInstance({ runtime: 'hermes', kind: 'docker', name: 'hermes-lab' });

  expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({
    name: 'hermes-lab',
    image: 'ghcr.io/nousresearch/hermes-agent:latest',
    env: expect.arrayContaining([
      expect.stringMatching(/^HERMES_HOME=/),
    ]),
  }));
});

it('builds Hermes fleet instances with hermes runtime metadata', async () => {
  const status = await backend.refresh();
  expect(status.instances[0].runtime).toBe('hermes');
  expect(status.instances[0].mode).toBe('docker');
});
```

- [ ] **Step 2: Run the new Hermes Docker tests**

Run: `cd packages/server && npx vitest run tests/services/hermes-docker-backend.test.ts`

Expected: FAIL because `hermes-docker-backend.ts` does not exist yet.

- [ ] **Step 3: Add Hermes Docker defaults to the config model**

```ts
const hermesDockerSchema = z.object({
  image: z.string().default('ghcr.io/nousresearch/hermes-agent:latest'),
  mountPath: z.string().default('/data/hermes'),
  env: z.record(z.string(), z.string()).default({}),
});
```

- [ ] **Step 4: Implement the Hermes Docker backend around the existing Docker service**

```ts
export class HermesDockerBackend implements DeploymentBackend {
  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const name = opts.name?.trim() || `hermes-${Date.now()}`;
    const homeDir = this.getHermesHomeDir(name);
    mkdirSync(homeDir, { recursive: true });

    await this.docker.createManagedContainer({
      name,
      index: nextIndex,
      image: opts.image ?? this.cfg.image,
      gatewayPort: 0,
      token: '',
      timezone: 'UTC',
      configDir: homeDir,
      workspaceDir: join(homeDir, 'workspace'),
      cpuLimit: opts.cpuLimit ?? '1',
      memLimit: opts.memoryLimit ?? '1G',
      extraEnv: [
        `HERMES_HOME=${this.cfg.mountPath}`,
        ...Object.entries(this.cfg.env).map(([key, value]) => `${key}=${value}`),
      ],
      binds: [
        `${homeDir}:${this.cfg.mountPath}`,
      ],
      command: ['hermes', 'gateway'],
      exposedTcpPorts: [],
    });

    return this.refreshAndFind(name);
  }
}
```

- [ ] **Step 5: Extend `DockerService` to support runtime-specific commands and binds**

```ts
export interface ManagedContainerSpec {
  name: string;
  index: number;
  image: string;
  gatewayPort: number;
  token: string;
  timezone: string;
  configDir: string;
  workspaceDir: string;
  npmDir?: string;
  cpuLimit: string;
  memLimit: string;
  command?: string[];
  binds?: string[];
  extraEnv?: string[];
  exposedTcpPorts?: number[];
}

const binds = spec.binds ?? [
  `${spec.configDir}:/home/node/.openclaw`,
  `${spec.workspaceDir}:/home/node/.openclaw/workspace`,
];

const env = [
  'HOME=/home/node',
  'TERM=xterm-256color',
  `TZ=${spec.timezone}`,
  ...spec.extraEnv ?? [],
];

const cmd = spec.command ?? ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789'];
```

- [ ] **Step 6: Reuse container metrics but set Hermes capabilities**

```ts
private toFleetInstance(container: ManagedContainer): FleetInstance {
  return {
    id: container.name,
    runtime: 'hermes',
    mode: 'docker',
    status: this.mapStatus(container.state),
    port: 0,
    token: 'hidden',
    uptime: container.uptime,
    cpu: container.cpu,
    memory: container.memory,
    disk: container.disk,
    health: 'none',
    image: container.image,
    runtimeCapabilities: {
      configEditor: true,
      logs: true,
      rename: true,
      delete: true,
      proxyAccess: false,
      sessions: false,
      plugins: false,
      runtimeAdmin: true,
    },
  };
}
```

- [ ] **Step 7: Re-run the Hermes Docker tests**

Run: `cd packages/server && npx vitest run tests/services/hermes-docker-backend.test.ts`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/hermes-docker-backend.ts packages/server/src/services/docker.ts packages/server/src/config.ts packages/server/tests/services/hermes-docker-backend.test.ts
git commit -m "feat: add hermes docker backend"
```

## Task 4: Turn HybridBackend Into a Runtime+Mode Router

**Files:**
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/routes/instances.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`
- Modify: `packages/server/tests/routes/config.test.ts`
- Modify: `packages/server/tests/routes/sessions.test.ts`
- Modify: `packages/server/tests/routes/instances.test.ts`

- [ ] **Step 1: Extend router tests to cover all four runtime/mode combinations**

```ts
it('createInstance dispatches by runtime and kind', async () => {
  await backend.createInstance({ runtime: 'hermes', kind: 'profile', name: 'research-bot' });
  await backend.createInstance({ runtime: 'hermes', kind: 'docker', name: 'hermes-lab' });

  expect(hermesProfileBackend.createInstance).toHaveBeenCalledWith({
    runtime: 'hermes',
    kind: 'profile',
    name: 'research-bot',
  });
  expect(hermesDockerBackend.createInstance).toHaveBeenCalledWith({
    runtime: 'hermes',
    kind: 'docker',
    name: 'hermes-lab',
  });
});
```

- [ ] **Step 2: Run router and route tests**

Run: `cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts tests/routes/config.test.ts tests/routes/sessions.test.ts tests/routes/instances.test.ts`

Expected: FAIL because the router only knows about two OpenClaw backends and the routes still assume OpenClaw sessions and commands.

- [ ] **Step 3: Inject Hermes backends in `index.ts` and expand the router constructor**

```ts
const backend = new HybridBackend({
  openclawDocker: dockerBackend,
  openclawProfile: profileBackend,
  hermesDocker: hermesDockerBackend,
  hermesProfile: hermesProfileBackend,
  userService,
});
```

- [ ] **Step 4: Route by both runtime and mode, not just mode**

```ts
async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
  if (opts.runtime === 'openclaw' && opts.kind === 'docker') {
    return this.backends.openclawDocker.createInstance(opts);
  }
  if (opts.runtime === 'openclaw' && opts.kind === 'profile') {
    return this.backends.openclawProfile.createInstance(opts);
  }
  if (opts.runtime === 'hermes' && opts.kind === 'docker') {
    return this.backends.hermesDocker.createInstance(opts);
  }
  if (opts.runtime === 'hermes' && opts.kind === 'profile') {
    return this.backends.hermesProfile.createInstance(opts);
  }
  throw new Error(`Unsupported runtime/kind combination: ${opts.runtime}/${opts.kind}`);
}
```

- [ ] **Step 5: Gate OpenClaw-only routes and background fetches by runtime capability**

```ts
const running = (status?.instances ?? []).filter((instance) =>
  instance.status === 'running' && instance.runtimeCapabilities.sessions,
);
```

```ts
if (!instance.runtimeCapabilities.runtimeAdmin) {
  return reply.status(409).send({
    error: `Instance "${id}" does not support this action`,
    code: 'UNSUPPORTED_RUNTIME_ACTION',
  });
}
```

- [ ] **Step 6: Re-run the router and route tests**

Run: `cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts tests/routes/config.test.ts tests/routes/sessions.test.ts tests/routes/instances.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/hybrid-backend.ts packages/server/src/index.ts packages/server/src/routes/config.ts packages/server/src/routes/sessions.ts packages/server/src/routes/instances.ts packages/server/tests/services/hybrid-backend.test.ts packages/server/tests/routes/config.test.ts packages/server/tests/routes/sessions.test.ts packages/server/tests/routes/instances.test.ts
git commit -m "refactor: route fleet operations by runtime and mode"
```

## Task 5: Update The Web UI For Mixed Runtime Fleet Management

**Files:**
- Modify: `packages/web/src/components/instances/AddInstanceDialog.tsx`
- Modify: `packages/web/src/components/instances/InstanceManagementPanel.tsx`
- Modify: `packages/web/src/components/instances/InstancePanel.tsx`
- Modify: `packages/web/src/components/instances/OverviewTab.tsx`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`
- Create: `packages/web/src/components/instances/AddInstanceDialog.test.tsx`
- Create: `packages/web/src/components/instances/InstancePanel.test.tsx`

- [ ] **Step 1: Write failing web tests for runtime selection and capability-gated tabs**

```tsx
it('submits runtime and kind when creating a Hermes profile instance', async () => {
  render(<AddInstanceDialog runtime="hermes" kind="profile" onClose={vi.fn()} />);

  await user.type(screen.getByLabelText(/instance name/i), 'research-bot');
  await user.click(screen.getByRole('button', { name: /create/i }));

  expect(createInstance).toHaveBeenCalledWith(expect.objectContaining({
    runtime: 'hermes',
    kind: 'profile',
    name: 'research-bot',
  }));
});

it('hides control-ui and plugins tabs for Hermes instances without those capabilities', async () => {
  render(<InstancePanel instanceId="research-bot" />);
  expect(screen.queryByRole('button', { name: /control ui/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /plugins/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the web tests and confirm the current UI is OpenClaw-shaped**

Run: `cd packages/web && npx vitest run src/components/instances/AddInstanceDialog.test.tsx src/components/instances/InstancePanel.test.tsx`

Expected: FAIL because `AddInstanceDialog` only knows `kind`, and `InstancePanel` always renders OpenClaw tabs.

- [ ] **Step 3: Add runtime selection to the create-instance flow**

```tsx
interface Props {
  runtime: 'openclaw' | 'hermes';
  kind: 'docker' | 'profile';
  onClose: () => void;
}

const create = useMutation({
  mutationFn: () => createInstance({
    runtime,
    kind,
    name,
    // existing mode-specific fields
  }),
});
```

- [ ] **Step 4: Update the management table to render runtime + mode**

```tsx
<td>
  <span className="pill">{instance.runtime === 'hermes' ? t('runtimeHermes') : t('runtimeOpenClaw')}</span>
</td>
<td>
  {instance.mode === 'docker' ? t('dockerInstanceType') : t('profileInstanceType')}
</td>
```

- [ ] **Step 5: Make instance tabs capability-driven**

```tsx
const tabs: Tab[] = [
  'overview',
  ...(instance.runtimeCapabilities.logs ? ['logs'] : []),
  ...(instance.runtimeCapabilities.configEditor ? ['config'] : []),
  ...(instance.runtimeCapabilities.sessions ? ['activity'] : []),
  ...(instance.runtimeCapabilities.proxyAccess ? ['controlui'] : []),
  ...(instance.runtimeCapabilities.plugins ? ['plugins'] : []),
];
```

- [ ] **Step 6: Update overview cards and translations for mixed runtimes**

```tsx
<p className="metric-label">{t('runtime')}</p>
<p className="metric-value">
  {instance.runtime === 'hermes' ? t('runtimeHermes') : t('runtimeOpenClaw')}
</p>
```

- [ ] **Step 7: Re-run the web tests**

Run: `cd packages/web && npx vitest run src/components/instances/AddInstanceDialog.test.tsx src/components/instances/InstancePanel.test.tsx`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/components/instances/AddInstanceDialog.tsx packages/web/src/components/instances/InstanceManagementPanel.tsx packages/web/src/components/instances/InstancePanel.tsx packages/web/src/components/instances/OverviewTab.tsx packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts packages/web/src/components/instances/AddInstanceDialog.test.tsx packages/web/src/components/instances/InstancePanel.test.tsx
git commit -m "feat: add hermes runtime support to fleet UI"
```

## Task 6: Final Verification And Documentation Sweep

**Files:**
- Modify: `README.md`
- Modify: `docs/arch/README.md`
- Modify: `docs/arch/README_CN.md`

- [ ] **Step 1: Write failing assertions for any missing mixed-runtime documentation or skip this step if docs are intentionally deferred**

```md
Document the fleet model as:
- OpenClaw profile
- OpenClaw docker
- Hermes profile
- Hermes docker
```

- [ ] **Step 2: Run the focused verification suite**

Run: `npm run test`

Expected: PASS across `packages/server` and `packages/web`

- [ ] **Step 3: Run a build to catch type drift**

Run: `npm run build`

Expected: PASS with both server and web compiling cleanly

- [ ] **Step 4: Add operator-facing docs for Hermes runtime support**

```md
## Hermes gateway support

Claw Fleet Manager now supports Hermes instances in the same fleet list as OpenClaw.
Hermes instances support both `profile` and `docker` deployment modes.
OpenClaw-only tabs such as Control UI remain hidden for Hermes instances unless explicitly supported.
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/arch/README.md docs/arch/README_CN.md
git commit -m "docs: describe hermes fleet support"
```
