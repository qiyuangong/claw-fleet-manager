# Instance Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow fleet instances to be migrated between Docker and profile modes while preserving workspace data and gateway token.

**Architecture:** Migration is coordinated by `HybridBackend.migrate()` which calls concrete helpers on each backend (`createInstanceFromMigration`). The route `POST /api/fleet/instances/:id/migrate` is only valid in hybrid mode. The web UI adds a Migrate button to `OverviewTab` visible to admins.

**Tech Stack:** TypeScript, Fastify, Vitest, React 19, React Query, @tanstack/react-query

---

## File Map

| File | Change |
|---|---|
| `packages/server/src/services/profile-backend.ts` | Add `createInstanceFromMigration()` + `getInstanceDir()` |
| `packages/server/src/services/docker-backend.ts` | Add `createInstanceFromMigration()` + `getDockerConfigDir()` + `getDockerWorkspaceDir()` |
| `packages/server/src/services/hybrid-backend.ts` | Change constructor to concrete types; add `migrate()` |
| `packages/server/src/routes/migrate.ts` | Create — `POST /api/fleet/instances/:id/migrate` |
| `packages/server/src/index.ts` | Register migrate route |
| `packages/server/tests/services/profile-backend.test.ts` | Add `createInstanceFromMigration` tests |
| `packages/server/tests/services/docker-backend.test.ts` | Add `createInstanceFromMigration` tests |
| `packages/server/tests/services/hybrid-backend.test.ts` | Add `migrate` tests; remove stale `scaleFleet` from mocks |
| `packages/server/tests/routes/migrate.test.ts` | Create — route tests |
| `packages/web/src/api/fleet.ts` | Add `migrateInstance()` |
| `packages/web/src/components/instances/MigrateDialog.tsx` | Create — migrate dialog |
| `packages/web/src/components/instances/OverviewTab.tsx` | Add Migrate button |
| `packages/web/src/i18n/locales/en.ts` | Add migration i18n keys |

---

## Task 1: `ProfileBackend` — `createInstanceFromMigration` and `getInstanceDir`

**Files:**
- Modify: `packages/server/src/services/profile-backend.ts`
- Modify: `packages/server/tests/services/profile-backend.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block at the end of `packages/server/tests/services/profile-backend.test.ts`:

```ts
describe('ProfileBackend — createInstanceFromMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    const mockServer = {
      listen: vi.fn((_port: number, cb: () => void) => cb()),
      close: vi.fn((cb: () => void) => cb()),
      on: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345 };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => {
      cb(null, { stdout: '/usr/local/bin/openclaw', stderr: '' });
      return {} as any;
    });
  });

  it('createInstanceFromMigration() writes openclaw.json with preserved token and workspace path', async () => {
    const backend = makeBackend();
    await backend.initialize();

    await backend.createInstanceFromMigration({
      name: 'migrated',
      workspaceDir: '/tmp/docker-base/migrated/workspace',
      configDir: '/tmp/docker-base/migrated/config',
      token: 'abc123preserved',
    });

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const configWrite = writeCalls.find(([path]) => String(path).includes('openclaw.json'));
    expect(configWrite).toBeDefined();
    const written = JSON.parse(String(configWrite![1]));
    expect(written.gateway.auth.token).toBe('abc123preserved');
    expect(written.agents.defaults.workspace).toBe('/tmp/docker-base/migrated/workspace');
  });

  it('createInstanceFromMigration() registers profile in registry', async () => {
    const backend = makeBackend();
    await backend.initialize();

    await backend.createInstanceFromMigration({
      name: 'migrated',
      workspaceDir: '/tmp/docker-base/migrated/workspace',
      configDir: '/tmp/docker-base/migrated/config',
      token: 'abc123',
    });

    const { stateDir } = backend.getInstanceDir('migrated');
    expect(stateDir).toBe('/tmp/docker-base/migrated');
  });

  it('getInstanceDir() throws when profile not found', async () => {
    const backend = makeBackend();
    await backend.initialize();
    expect(() => backend.getInstanceDir('nonexistent')).toThrow('not found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts
```

Expected: FAIL — `createInstanceFromMigration` is not a function, `getInstanceDir` is not a function.

- [ ] **Step 3: Add `getInstanceDir` to `ProfileBackend`**

In `packages/server/src/services/profile-backend.ts`, add this public method after `writeInstanceConfig`:

```ts
  getInstanceDir(id: string): { stateDir: string; configPath: string } {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    return { stateDir: entry.stateDir, configPath: entry.configPath };
  }
```

- [ ] **Step 4: Add `createInstanceFromMigration` to `ProfileBackend`**

In `packages/server/src/services/profile-backend.ts`, add this public method after `getInstanceDir`:

```ts
  async createInstanceFromMigration(opts: {
    name: string;
    workspaceDir: string;
    configDir: string;
    token: string;
    port?: number;
  }): Promise<FleetInstance> {
    if (this.registry.profiles[opts.name]) {
      throw new Error(`Profile "${opts.name}" already exists`);
    }

    const port = opts.port ?? this.registry.nextPort;
    await this.probePort(port);

    const configPath = join(opts.configDir, 'openclaw.json');
    const stateDir = dirname(opts.workspaceDir);

    const profileConfig = {
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: opts.token },
      },
      agents: {
        defaults: { workspace: opts.workspaceDir },
      },
    };

    await mkdir(opts.configDir, { recursive: true });
    await mkdir(opts.workspaceDir, { recursive: true });
    this.seedWorkspaceFiles(opts.workspaceDir);

    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(profileConfig, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);

    const entry: ProfileEntry = { name: opts.name, port, pid: null, configPath, stateDir };
    this.registry.profiles[opts.name] = entry;
    if (opts.port === undefined) {
      this.registry.nextPort = port + this.cfg.portStep;
    }
    this.saveRegistry();

    await this.start(opts.name);
    await this.refresh();

    const instance = this.cache?.instances.find((i) => i.id === opts.name);
    if (!instance) throw new Error(`Instance "${opts.name}" not found after migration`);
    return instance;
  }
```

- [ ] **Step 5: Run tests**

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts
```

Expected: new tests pass, existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/profile-backend.ts \
  packages/server/tests/services/profile-backend.test.ts
git commit -m "feat: add ProfileBackend.createInstanceFromMigration and getInstanceDir"
```

---

## Task 2: `DockerBackend` — `createInstanceFromMigration`, `getDockerConfigDir`, `getDockerWorkspaceDir`

**Files:**
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block at the end of `packages/server/tests/services/docker-backend.test.ts`:

```ts
describe('DockerBackend — createInstanceFromMigration', () => {
  it('createInstanceFromMigration() creates container with explicit token and workspaceDir', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([]);
    mockFleetConfig.readFleetEnvRaw.mockReturnValue({ BASE_URL: 'http://api', API_KEY: 'key', MODEL_ID: 'gpt-4' });

    await backend.createInstanceFromMigration({
      name: 'team-alpha',
      workspaceDir: '/tmp/profile-states/team-alpha/workspace',
      token: 'preserved-token-xyz',
    });

    expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'team-alpha',
        token: 'preserved-token-xyz',
        workspaceDir: '/tmp/profile-states/team-alpha/workspace',
      }),
    );
  });

  it('createInstanceFromMigration() writes Docker openclaw.json with container-internal workspace path', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([]);
    mockFleetConfig.readFleetEnvRaw.mockReturnValue({});
    mockFleetConfig.getDockerConfigDir.mockReturnValue('/tmp/managed/team-alpha/config');

    await backend.createInstanceFromMigration({
      name: 'team-alpha',
      workspaceDir: '/tmp/states/team-alpha/workspace',
      token: 'tok',
    });

    const { mkdirSync, writeFileSync } = await import('node:fs');
    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const configWrite = writeCalls.find(([p]) => String(p).includes('openclaw.json'));
    expect(configWrite).toBeDefined();
    const written = JSON.parse(String(configWrite![1]));
    expect(written.agents.defaults.workspace).toBe('/home/node/.openclaw/workspace');
    expect(written.gateway.auth.token).toBe('tok');
  });

  it('getDockerConfigDir() delegates to fleetConfig', () => {
    mockFleetConfig.getDockerConfigDir.mockReturnValue('/tmp/managed/foo/config');
    expect(backend.getDockerConfigDir('foo')).toBe('/tmp/managed/foo/config');
  });

  it('getDockerWorkspaceDir() delegates to fleetConfig', () => {
    mockFleetConfig.getDockerWorkspaceDir.mockReturnValue('/tmp/managed/foo/workspace');
    expect(backend.getDockerWorkspaceDir('foo')).toBe('/tmp/managed/foo/workspace');
  });
});
```

- [ ] **Step 2: Add `vi.mock('node:fs')` at the top of the test file**

In `packages/server/tests/services/docker-backend.test.ts`, add near the top after existing imports:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));
```

- [ ] **Step 3: Run tests to verify new tests fail**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: new tests FAIL — `createInstanceFromMigration` not defined.

- [ ] **Step 4: Add `getDockerConfigDir`, `getDockerWorkspaceDir`, and `createInstanceFromMigration` to `DockerBackend`**

In `packages/server/src/services/docker-backend.ts`, add these imports at the top:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
```

Add the three new public methods after `writeInstanceConfig`:

```ts
  getDockerConfigDir(instanceId: string): string {
    return this.fleetConfig.getDockerConfigDir(instanceId);
  }

  getDockerWorkspaceDir(instanceId: string): string {
    return this.fleetConfig.getDockerWorkspaceDir(instanceId);
  }

  async createInstanceFromMigration(opts: {
    name: string;
    workspaceDir: string;
    token: string;
  }): Promise<FleetInstance> {
    const containers = await this.docker.listFleetContainers();
    if (containers.some((c) => c.name === opts.name)) {
      throw new Error(`Instance "${opts.name}" already exists`);
    }

    const usedIndexes = containers
      .map((c) => c.index)
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b);
    const newIndex = nextAvailableIndex(usedIndexes);

    const config = this.fleetConfig.readFleetConfig();
    const resolvedPortStep = config.portStep;
    const vars = this.fleetConfig.readFleetEnvRaw();

    const tokens = this.fleetConfig.readTokens();
    this.fleetConfig.writeTokens({ ...tokens, [newIndex]: opts.token });
    this.fleetConfig.ensureFleetDirectories();

    const configDir = this.fleetConfig.getDockerConfigDir(opts.name);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(opts.workspaceDir, { recursive: true });

    const gatewayPort = BASE_GW_PORT + (newIndex - 1) * resolvedPortStep;
    const openclawConfig: Record<string, unknown> = {
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: opts.token },
        controlUi: {
          allowedOrigins: [
            `http://127.0.0.1:${gatewayPort}`,
            `http://localhost:${gatewayPort}`,
          ],
        },
      },
      agents: {
        defaults: { workspace: '/home/node/.openclaw/workspace' },
      },
      clawFleet: { portStep: resolvedPortStep },
    };

    const baseUrl = vars.BASE_URL ?? '';
    const apiKey = vars.API_KEY ?? '';
    const modelId = vars.MODEL_ID ?? '';
    if (baseUrl && modelId) {
      openclawConfig.models = {
        mode: 'merge',
        providers: {
          default: {
            baseUrl,
            apiKey,
            api: 'openai-completions',
            models: [{ id: modelId, name: modelId }],
          },
        },
      };
    }

    if (this.tailscale && this.tailscaleHostname) {
      const portMap = this.tailscale.allocatePorts([newIndex]);
      const tsPort = portMap.get(newIndex);
      if (tsPort !== undefined) {
        const gw = openclawConfig.gateway as Record<string, unknown>;
        const auth = gw.auth as Record<string, unknown>;
        auth.allowTailscale = true;
        const controlUi = gw.controlUi as Record<string, unknown>;
        controlUi.allowInsecureAuth = true;
        (controlUi.allowedOrigins as string[]).push(
          `https://${this.tailscaleHostname}:${tsPort}`,
        );
      }
    }

    const configFile = join(configDir, 'openclaw.json');
    writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2) + '\n');

    await this.docker.createManagedContainer({
      name: opts.name,
      index: newIndex,
      image: config.openclawImage,
      gatewayPort,
      token: opts.token,
      timezone: config.tz,
      configDir,
      workspaceDir: opts.workspaceDir,
      cpuLimit: config.cpuLimit,
      memLimit: config.memLimit,
    });

    let tailscaleWarning: string | undefined;
    if (this.tailscale) {
      try {
        await this.tailscale.setup(newIndex, gatewayPort);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tailscaleWarning = `Tailscale setup failed: ${message}`;
        this.log?.error({ err, newIndex }, 'Tailscale setup failed during migration');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((i) => i.id === opts.name);
    if (!instance) throw new Error(`Instance "${opts.name}" not found after migration`);
    return tailscaleWarning ? { ...instance, tailscaleWarning } : instance;
  }
```

- [ ] **Step 5: Run tests**

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/docker-backend.ts \
  packages/server/tests/services/docker-backend.test.ts
git commit -m "feat: add DockerBackend.createInstanceFromMigration and path accessors"
```

---

## Task 3: `HybridBackend.migrate()`

**Files:**
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`

- [ ] **Step 1: Write failing tests**

Add at the end of `packages/server/tests/services/hybrid-backend.test.ts`:

```ts
import { join } from 'node:path';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  unlinkSync: vi.fn(),
}));

describe('HybridBackend — migrate', () => {
  const migratedProfileInstance = {
    id: 'openclaw-1',
    mode: 'profile' as const,
    status: 'running' as const,
    port: 18789,
    token: 'masked',
    uptime: 10,
    cpu: 0,
    memory: { used: 0, limit: 0 },
    disk: { config: 0, workspace: 0 },
    health: 'healthy' as const,
    image: 'openclaw',
    profile: 'openclaw-1',
  };

  const migratedDockerInstance = {
    ...dockerInstance,
    id: 'team-alpha',
    mode: 'docker' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Add migration methods to existing mocks
    (dockerBackend as any).createInstanceFromMigration = vi.fn().mockResolvedValue(migratedDockerInstance);
    (dockerBackend as any).getDockerConfigDir = vi.fn().mockReturnValue('/tmp/managed/openclaw-1/config');
    (dockerBackend as any).getDockerWorkspaceDir = vi.fn().mockReturnValue('/tmp/managed/openclaw-1/workspace');
    (profileBackend as any).createInstanceFromMigration = vi.fn().mockResolvedValue(migratedProfileInstance);
    (profileBackend as any).getInstanceDir = vi.fn().mockReturnValue({ stateDir: '/tmp/states/team-alpha', configPath: '/tmp/states/team-alpha/openclaw.json' });

    dockerBackend.getCachedStatus.mockReturnValue({
      mode: 'docker',
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: Date.now(),
    });
    profileBackend.getCachedStatus.mockReturnValue({
      mode: 'profiles',
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: Date.now(),
    });
    dockerBackend.refresh.mockResolvedValue({ mode: 'docker', instances: [dockerInstance], totalRunning: 1, updatedAt: Date.now() });
    profileBackend.refresh.mockResolvedValue({ mode: 'profiles', instances: [profileInstance], totalRunning: 1, updatedAt: Date.now() });
    dockerBackend.stop.mockResolvedValue(undefined);
    dockerBackend.revealToken.mockResolvedValue('plain-token');
    profileBackend.stop.mockResolvedValue(undefined);
    profileBackend.revealToken.mockResolvedValue('plain-token');
    dockerBackend.removeInstance.mockResolvedValue(undefined);
    profileBackend.removeInstance.mockResolvedValue(undefined);
  });

  it('migrate() docker→profile stops container and calls profileBackend.createInstanceFromMigration', async () => {
    const result = await backend.migrate('openclaw-1', { targetMode: 'profile' });

    expect(dockerBackend.stop).toHaveBeenCalledWith('openclaw-1');
    expect(dockerBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
    expect((profileBackend as any).createInstanceFromMigration).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'openclaw-1', token: 'plain-token' }),
    );
    expect(result.mode).toBe('profile');
  });

  it('migrate() docker→profile with deleteSource removes docker instance', async () => {
    await backend.migrate('openclaw-1', { targetMode: 'profile', deleteSource: true });

    expect(dockerBackend.removeInstance).toHaveBeenCalledWith('openclaw-1');
  });

  it('migrate() docker→profile without deleteSource does not remove docker instance', async () => {
    await backend.migrate('openclaw-1', { targetMode: 'profile', deleteSource: false });

    expect(dockerBackend.removeInstance).not.toHaveBeenCalled();
  });

  it('migrate() profile→docker stops profile and calls dockerBackend.createInstanceFromMigration', async () => {
    const result = await backend.migrate('team-alpha', { targetMode: 'docker' });

    expect(profileBackend.stop).toHaveBeenCalledWith('team-alpha');
    expect(profileBackend.revealToken).toHaveBeenCalledWith('team-alpha');
    expect((dockerBackend as any).createInstanceFromMigration).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'team-alpha', token: 'plain-token' }),
    );
    expect(result.mode).toBe('docker');
  });

  it('migrate() throws when instance not found', async () => {
    await expect(backend.migrate('nonexistent', { targetMode: 'docker' })).rejects.toThrow('not found');
  });

  it('migrate() throws when instance is already in target mode', async () => {
    await expect(backend.migrate('openclaw-1', { targetMode: 'docker' })).rejects.toThrow('already in docker mode');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts
```

Expected: new tests FAIL — `migrate` is not a function.

- [ ] **Step 3: Update `HybridBackend` constructor types and add `migrate`**

In `packages/server/src/services/hybrid-backend.ts`, replace the imports and class definition:

```ts
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CreateInstanceOpts, DeploymentBackend, LogHandle } from './backend.js';
import type { DockerBackend } from './docker-backend.js';
import type { ProfileBackend } from './profile-backend.js';
import type { FleetInstance, FleetStatus } from '../types.js';

export interface MigrateOpts {
  targetMode: 'docker' | 'profile';
  deleteSource?: boolean;
}

export class HybridBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;

  constructor(
    private dockerBackend: DockerBackend,
    private profileBackend: ProfileBackend,
  ) {}
```

Add the `migrate` method at the end of the class (before the closing `}`):

```ts
  async migrate(id: string, opts: MigrateOpts): Promise<FleetInstance> {
    const status = this.getCachedStatus() ?? await this.refresh();
    const source = status.instances.find((i) => i.id === id);
    if (!source) throw new Error(`Instance "${id}" not found`);
    if (source.mode === opts.targetMode) {
      throw new Error(`Instance "${id}" is already in ${opts.targetMode} mode`);
    }

    if (opts.targetMode === 'profile') {
      await this.dockerBackend.stop(id);
      const token = await this.dockerBackend.revealToken(id);
      const workspaceDir = this.dockerBackend.getDockerWorkspaceDir(id);
      const configDir = this.dockerBackend.getDockerConfigDir(id);
      const configFile = join(configDir, 'openclaw.json');
      if (existsSync(configFile)) unlinkSync(configFile);

      const newInstance = await this.profileBackend.createInstanceFromMigration({
        name: id, workspaceDir, configDir, token,
      });

      if (opts.deleteSource) await this.dockerBackend.removeInstance(id);
      await this.refresh();
      return newInstance;
    }

    // Profile → Docker
    await this.profileBackend.stop(id);
    const token = await this.profileBackend.revealToken(id);
    const { stateDir } = this.profileBackend.getInstanceDir(id);
    const workspaceDir = join(stateDir, 'workspace');
    const dockerConfigDir = this.dockerBackend.getDockerConfigDir(id);
    const dockerConfigFile = join(dockerConfigDir, 'openclaw.json');
    if (existsSync(dockerConfigFile)) unlinkSync(dockerConfigFile);

    const newInstance = await this.dockerBackend.createInstanceFromMigration({
      name: id, workspaceDir, token,
    });

    if (opts.deleteSource) await this.profileBackend.removeInstance(id);
    await this.refresh();
    return newInstance;
  }
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run full test suite**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/hybrid-backend.ts \
  packages/server/tests/services/hybrid-backend.test.ts
git commit -m "feat: add HybridBackend.migrate for docker↔profile instance migration"
```

---

## Task 4: Migrate route + registration

**Files:**
- Create: `packages/server/src/routes/migrate.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/tests/routes/migrate.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `packages/server/tests/routes/migrate.test.ts`:

```ts
// packages/server/tests/routes/migrate.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { migrateRoutes } from '../../src/routes/migrate.js';

const migratedInstance = {
  id: 'openclaw-1',
  mode: 'profile' as const,
  status: 'running' as const,
  port: 18789,
  token: 'abc1***f456',
  uptime: 0,
  cpu: 0,
  memory: { used: 0, limit: 0 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy' as const,
  image: 'openclaw',
};

const mockBackend = {
  getCachedStatus: vi.fn(),
  migrate: vi.fn().mockResolvedValue(migratedInstance),
};

describe('Migrate routes', () => {
  const app = Fastify();

  beforeEach(() => { vi.clearAllMocks(); });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'hybrid');
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(migrateRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/instances/:id/migrate delegates to backend.migrate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.migrate).toHaveBeenCalledWith('openclaw-1', { targetMode: 'profile', deleteSource: false });
    expect(res.json().mode).toBe('profile');
  });

  it('POST /api/fleet/instances/:id/migrate passes deleteSource=true', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile', deleteSource: true },
    });
    expect(mockBackend.migrate).toHaveBeenCalledWith('openclaw-1', { targetMode: 'profile', deleteSource: true });
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 for non-hybrid mode', async () => {
    const app2 = Fastify();
    app2.decorate('backend', mockBackend);
    app2.decorate('deploymentMode', 'docker');
    app2.decorate('fleetDir', '/tmp');
    app2.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app2.register(migrateRoutes);
    await app2.ready();

    const res = await app2.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MODE_UNAVAILABLE');

    await app2.close();
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 for invalid targetMode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/instances/:id/migrate returns 404 when backend throws not found', async () => {
    mockBackend.migrate.mockRejectedValueOnce(new Error('Instance "openclaw-1" not found'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 when already in target mode', async () => {
    mockBackend.migrate.mockRejectedValueOnce(new Error('already in profile mode'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ALREADY_TARGET_MODE');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/routes/migrate.test.ts
```

Expected: FAIL — `migrateRoutes` not found.

- [ ] **Step 3: Create `packages/server/src/routes/migrate.ts`**

```ts
// packages/server/src/routes/migrate.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { safeError } from '../errors.js';
import { validateInstanceId } from '../validate.js';
import { errorResponseSchema, fleetInstanceSchema, instanceIdParamsSchema } from '../schemas.js';
import type { HybridBackend, MigrateOpts } from '../services/hybrid-backend.js';

const migrateBodySchema = z.object({
  targetMode: z.enum(['docker', 'profile']),
  deleteSource: z.boolean().optional(),
});

export async function migrateRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/instances/:id/migrate', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Instances'],
      summary: 'Migrate an instance between docker and profile modes',
      params: instanceIdParamsSchema,
      body: {
        type: 'object',
        properties: {
          targetMode: { type: 'string', enum: ['docker', 'profile'] },
          deleteSource: { type: 'boolean' },
        },
        required: ['targetMode'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (app.deploymentMode !== 'hybrid') {
      return reply.status(400).send({
        error: 'Migration is only available in hybrid deployment mode',
        code: 'MODE_UNAVAILABLE',
      });
    }

    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }

    const parsed = migrateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }

    const opts: MigrateOpts = {
      targetMode: parsed.data.targetMode,
      deleteSource: parsed.data.deleteSource ?? false,
    };

    try {
      const instance = await (app.backend as unknown as HybridBackend).migrate(id, opts);
      return instance;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) {
        return reply.status(404).send({ error: safeError(error), code: 'INSTANCE_NOT_FOUND' });
      }
      if (msg.includes('already in')) {
        return reply.status(400).send({ error: safeError(error), code: 'ALREADY_TARGET_MODE' });
      }
      return reply.status(500).send({ error: safeError(error), code: 'MIGRATE_FAILED' });
    }
  });
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/server && npx vitest run tests/routes/migrate.test.ts
```

Expected: all pass.

- [ ] **Step 5: Register the route in `index.ts`**

In `packages/server/src/index.ts`, add the import after the existing route imports:

```ts
import { migrateRoutes } from './routes/migrate.js';
```

Add the registration after `await app.register(instanceRoutes);`:

```ts
await app.register(migrateRoutes);
```

- [ ] **Step 6: Run full test suite**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/migrate.ts \
  packages/server/src/index.ts \
  packages/server/tests/routes/migrate.test.ts
git commit -m "feat: add POST /api/fleet/instances/:id/migrate route"
```

---

## Task 5: Web API client and `MigrateDialog`

**Files:**
- Modify: `packages/web/src/api/fleet.ts`
- Create: `packages/web/src/components/instances/MigrateDialog.tsx`
- Modify: `packages/web/src/i18n/locales/en.ts`

- [ ] **Step 1: Add `migrateInstance` to `packages/web/src/api/fleet.ts`**

Add at the end of the file:

```ts
export const migrateInstance = (id: string, body: { targetMode: 'docker' | 'profile'; deleteSource?: boolean }) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/migrate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
```

- [ ] **Step 2: Add migration i18n keys to `packages/web/src/i18n/locales/en.ts`**

Before the `// Language toggle` section, add:

```ts
  // Migration
  migrateInstance: 'Migrate',
  migrateInstanceTitle: 'Migrate Instance',
  migrateInstanceHelp: 'Move this instance to a different runtime mode. Workspace data is preserved.',
  migrateTargetMode: 'Target Mode',
  migrateDeleteSource: 'Remove source instance after migration',
  migrating: 'Migrating…',
  migrateCta: 'Migrate',
  migrateSuccessToast: '{{id}} migrated to {{mode}} mode',
```

- [ ] **Step 3: Create `packages/web/src/components/instances/MigrateDialog.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { migrateInstance } from '../../api/fleet';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
  onClose: () => void;
}

export function MigrateDialog({ instance, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [targetMode, setTargetMode] = useState<'docker' | 'profile'>(
    instance.mode === 'docker' ? 'profile' : 'docker',
  );
  const [deleteSource, setDeleteSource] = useState(false);
  const [error, setError] = useState('');

  const migrate = useMutation({
    mutationFn: () => migrateInstance(instance.id, { targetMode, deleteSource }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      toast.success(t('migrateSuccessToast', { id: instance.id, mode: targetMode }));
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>{t('migrateInstanceTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('migrateInstanceHelp')}</p>

        <p className="field-label">{t('migrateTargetMode')}</p>
        <div className="action-row" style={{ marginBottom: '1rem' }}>
          {(['docker', 'profile'] as const).map((mode) => (
            <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: mode === instance.mode ? 'not-allowed' : 'pointer', opacity: mode === instance.mode ? 0.4 : 1 }}>
              <input
                type="radio"
                name="targetMode"
                value={mode}
                checked={targetMode === mode}
                disabled={mode === instance.mode}
                onChange={() => setTargetMode(mode)}
              />
              {mode === 'docker' ? 'Docker' : 'Profile'}
            </label>
          ))}
        </div>

        <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={deleteSource}
            onChange={(e) => setDeleteSource(e.target.checked)}
          />
          {t('migrateDeleteSource')}
        </label>

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => migrate.mutate()}
            disabled={migrate.isPending}
          >
            {migrate.isPending ? t('migrating') : t('migrateCta')}
          </button>
          <button className="secondary-button" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build web to confirm no TypeScript errors**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/fleet.ts \
  packages/web/src/components/instances/MigrateDialog.tsx \
  packages/web/src/i18n/locales/en.ts
git commit -m "feat: add MigrateDialog and migrateInstance API client"
```

---

## Task 6: Wire `MigrateDialog` into `OverviewTab`

**Files:**
- Modify: `packages/web/src/components/instances/OverviewTab.tsx`

- [ ] **Step 1: Update `OverviewTab` to include the Migrate button**

In `packages/web/src/components/instances/OverviewTab.tsx`, add the import at the top:

```ts
import { useState } from 'react';
import { useAppStore } from '../../store';
import { MigrateDialog } from './MigrateDialog';
```

Add `showMigrate` state and `currentUser` inside the component body, after the existing mutation declarations:

```ts
  const [showMigrate, setShowMigrate] = useState(false);
  const currentUser = useAppStore((state) => state.currentUser);
```

In the `action-row` div (after the restart button), add the Migrate button:

```tsx
          <div className="action-row" style={{ marginBottom: '1rem' }}>
            <button className="primary-button" onClick={() => start.mutate()} disabled={instance.status === 'running' || start.isPending}>
              {t('start')}
            </button>
            <button className="danger-button" onClick={() => stop.mutate()} disabled={instance.status === 'stopped' || stop.isPending}>
              {t('stop')}
            </button>
            <button className="secondary-button" onClick={() => restart.mutate()} disabled={instance.status === 'stopped' || restart.isPending}>
              {t('restart')}
            </button>
            {currentUser?.role === 'admin' ? (
              <button className="secondary-button" onClick={() => setShowMigrate(true)}>
                {t('migrateInstance')}
              </button>
            ) : null}
          </div>
```

At the end of the component return (before the final `</div>`), add the dialog:

```tsx
      {showMigrate ? (
        <MigrateDialog instance={instance} onClose={() => setShowMigrate(false)} />
      ) : null}
    </div>
  );
```

- [ ] **Step 2: Build web to confirm no TypeScript errors**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full server test suite one last time**

```bash
cd packages/server && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Verify no stale references**

```bash
grep -r "scaleFleet\|createInstanceFromMigration\|migrateRoutes" packages/server/src packages/web/src --include="*.ts" --include="*.tsx"
```

Expected: `createInstanceFromMigration` and `migrateRoutes` appear in their implementation files only, no `scaleFleet`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/instances/OverviewTab.tsx
git commit -m "feat: add Migrate button to OverviewTab for admin users"
```
