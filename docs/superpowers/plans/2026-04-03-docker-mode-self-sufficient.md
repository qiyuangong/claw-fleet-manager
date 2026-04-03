# Docker Mode — Self-Sufficient Fleet Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Docker mode self-sufficient — fleet manager writes per-instance `openclaw.json`, exposes image/npm config, and supports plugin management without relying on external setup scripts.

**Architecture:** Extend `ComposeGenerator` to write a minimal `openclaw.json` (gateway token + model config) for every new instance, add `OPENCLAW_IMAGE` and `ENABLE_NPM_PACKAGES` to `FleetConfig`, extract plugin routes from `profiles.ts` into a dedicated `plugins.ts` registered for both modes, and update the web UI accordingly.

**Tech Stack:** Node.js/TypeScript (Fastify server, Vitest tests), React 19 (web UI, no web tests — manual verify only).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/types.ts` | Modify | Add `openclawImage`, `enableNpmPackages` to `FleetConfig` |
| `packages/server/src/services/fleet-config.ts` | Modify | Read new fields from `fleet.env` |
| `packages/server/src/services/compose-generator.ts` | Modify | Write `openclaw.json`; literal image; `.npm` mount |
| `packages/server/src/routes/plugins.ts` | **Create** | Plugin management routes (both modes) |
| `packages/server/src/routes/profiles.ts` | Modify | Remove plugin routes (keep profile CRUD only) |
| `packages/server/src/index.ts` | Modify | Register `pluginRoutes` unconditionally |
| `packages/server/tests/services/fleet-config.test.ts` | Modify | Tests for new FleetConfig fields |
| `packages/server/tests/services/compose-generator.test.ts` | Modify | Tests for openclaw.json generation, image, .npm mount |
| `packages/server/tests/routes/plugins.test.ts` | **Create** | Tests for plugin routes in both modes |
| `packages/server/tests/routes/profiles.test.ts` | Modify | Remove plugin route tests (moved to plugins.test.ts) |
| `packages/web/src/components/config/FleetConfigPanel.tsx` | Modify | Add image input, API key input, npm toggle |
| `packages/web/src/components/instances/PluginsTab.tsx` | Modify | Remove `instance.profile` guard |

---

## Task 1: FleetConfig — add `openclawImage` and `enableNpmPackages`

**Files:**
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/src/services/fleet-config.ts`
- Test: `packages/server/tests/services/fleet-config.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/server/tests/services/fleet-config.test.ts` inside `describe('readFleetConfig', ...)`:

```ts
it('reads openclawImage from fleet.env', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), 'OPENCLAW_IMAGE=myrepo/openclaw:v2\n');
  const config = svc.readFleetConfig();
  expect(config.openclawImage).toBe('myrepo/openclaw:v2');
});

it('defaults openclawImage to openclaw:local when absent', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), 'BASE_URL=https://api.example.com/v1\n');
  const config = svc.readFleetConfig();
  expect(config.openclawImage).toBe('openclaw:local');
});

it('reads enableNpmPackages=true', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), 'ENABLE_NPM_PACKAGES=true\n');
  const config = svc.readFleetConfig();
  expect(config.enableNpmPackages).toBe(true);
});

it('defaults enableNpmPackages to false when absent', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), 'BASE_URL=https://api.example.com/v1\n');
  const config = svc.readFleetConfig();
  expect(config.enableNpmPackages).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/services/fleet-config.test.ts
```

Expected: 4 new tests fail with `TypeError: Cannot read properties of undefined (reading 'openclawImage')`

- [ ] **Step 3: Add fields to `FleetConfig` in `types.ts`**

```ts
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
  openclawImage: string;      // add
  enableNpmPackages: boolean; // add
}
```

- [ ] **Step 4: Read new fields in `fleet-config.ts`**

In `readFleetConfig()`, add two lines after `tz: vars.TZ ?? 'Asia/Shanghai',`:

```ts
openclawImage: vars.OPENCLAW_IMAGE ?? 'openclaw:local',
enableNpmPackages: vars.ENABLE_NPM_PACKAGES === 'true',
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run tests/services/fleet-config.test.ts
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/services/fleet-config.ts packages/server/tests/services/fleet-config.test.ts
git commit -m "feat: add openclawImage and enableNpmPackages to FleetConfig"
```

---

## Task 2: ComposeGenerator — write `openclaw.json` for all new instances

**Files:**
- Modify: `packages/server/src/services/compose-generator.ts`
- Test: `packages/server/tests/services/compose-generator.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/server/tests/services/compose-generator.test.ts`:

1. **Replace** the existing test `'does not write openclaw.json when tailscaleConfig is absent'` (line 94–98) — this test asserts the old behavior we're changing. Delete it.

2. **Add** these tests after the existing tests:

```ts
it('writes openclaw.json with gateway token and model config for new instances', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(2);

  const config1 = JSON.parse(
    readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
  );
  expect(config1.gateway.auth.mode).toBe('token');
  expect(config1.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
  expect(config1.gateway.mode).toBe('local');
  expect(config1.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18789');
  expect(config1.gateway.controlUi.allowedOrigins).toContain('http://localhost:18789');
  expect(config1.models.providers.default.baseUrl).toBe('https://api.example.com/v1');
  expect(config1.models.providers.default.apiKey).toBe('sk-test');
  expect(config1.models.providers.default.models[0].id).toBe('test-model');

  const config2 = JSON.parse(
    readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
  );
  expect(config2.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18809');
});

it('omits models block when BASE_URL is blank', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), [
    'PORT_STEP=20',
    `CONFIG_BASE=${join(dir, 'instances')}`,
    `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
  ].join('\n'));
  const gen = new ComposeGenerator(dir);
  gen.generate(1);

  const config = JSON.parse(
    readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
  );
  expect(config.models).toBeUndefined();
  expect(config.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
});

it('does not overwrite existing openclaw.json when regenerating without tailscale', () => {
  mkdirSync(join(dir, 'instances', '1'), { recursive: true });
  writeFileSync(join(dir, 'instances', '1', 'openclaw.json'), '{"custom":true}');

  const gen = new ComposeGenerator(dir);
  gen.generate(2);

  const content = JSON.parse(
    readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
  );
  expect(content.custom).toBe(true);
});

it('merges tailscale fields on top of base config', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(1, {
    hostname: 'machine.tailnet.ts.net',
    portMap: new Map([[1, 8800]]),
  });

  const config = JSON.parse(
    readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
  );
  // Base fields present
  expect(config.gateway.auth.mode).toBe('token');
  expect(config.models.providers.default.baseUrl).toBe('https://api.example.com/v1');
  // Tailscale fields added
  expect(config.gateway.auth.allowTailscale).toBe(true);
  expect(config.gateway.controlUi.allowInsecureAuth).toBe(true);
  expect(config.allowedOrigins).toContain('https://machine.tailnet.ts.net:8800');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```

Expected: new tests fail (no openclaw.json written without Tailscale); existing Tailscale test `'merges tailscale fields...'` fails too.

- [ ] **Step 3: Implement openclaw.json generation in `compose-generator.ts`**

In the `generate()` method, replace the `if (tailscaleConfig) { ... }` block inside the instance loop with:

```ts
if (i <= count) {
  mkdirSync(join(configBase, String(i)), { recursive: true });
  mkdirSync(join(workspaceBase, String(i)), { recursive: true });

  const configFile = join(configBase, String(i), 'openclaw.json');
  if (!existsSync(configFile)) {
    const gwPort = BASE_GW_PORT + (i - 1) * portStep;
    const baseUrl = vars.BASE_URL ?? '';
    const apiKey = vars.API_KEY ?? '';
    const modelId = vars.MODEL_ID ?? '';

    const openclawConfig: Record<string, unknown> = {
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: tokens[i] },
        controlUi: {
          allowedOrigins: [
            `http://127.0.0.1:${gwPort}`,
            `http://localhost:${gwPort}`,
          ],
        },
      },
    };

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

    if (tailscaleConfig) {
      const tsPort = tailscaleConfig.portMap.get(i);
      if (tsPort !== undefined) {
        const gw = openclawConfig.gateway as Record<string, unknown>;
        const auth = gw.auth as Record<string, unknown>;
        auth.allowTailscale = true;
        const controlUi = gw.controlUi as Record<string, unknown>;
        controlUi.allowInsecureAuth = true;
        openclawConfig.allowedOrigins = [
          `https://${tailscaleConfig.hostname}:${tsPort}`,
        ];
      }
    }

    writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2) + '\n');
  }
}
```

Also remove the `continue` statement that was inside the old Tailscale block (it caused the loop to skip writing `.env` entries for instances without a portMap entry — this logic is no longer needed since we handle `tsPort === undefined` above without skipping).

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/compose-generator.ts packages/server/tests/services/compose-generator.test.ts
git commit -m "feat: write openclaw.json for all new Docker instances"
```

---

## Task 3: ComposeGenerator — literal `OPENCLAW_IMAGE` + optional `.npm` mount

**Files:**
- Modify: `packages/server/src/services/compose-generator.ts`
- Test: `packages/server/tests/services/compose-generator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/server/tests/services/compose-generator.test.ts`:

```ts
it('writes literal OPENCLAW_IMAGE from fleet.env into compose', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), [
    'OPENCLAW_IMAGE=myrepo/openclaw:v2',
    'CPU_LIMIT=2',
    'MEM_LIMIT=4G',
    'PORT_STEP=20',
    `CONFIG_BASE=${join(dir, 'instances')}`,
    `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
  ].join('\n'));

  const gen = new ComposeGenerator(dir);
  gen.generate(1);

  const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
  expect(content).toContain('image: myrepo/openclaw:v2');
  expect(content).not.toContain('${OPENCLAW_IMAGE');
});

it('defaults image to openclaw:local when OPENCLAW_IMAGE is absent', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(1);

  const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
  expect(content).toContain('image: openclaw:local');
});

it('adds .npm mount per instance when ENABLE_NPM_PACKAGES=true', () => {
  writeFileSync(join(dir, 'config', 'fleet.env'), [
    'ENABLE_NPM_PACKAGES=true',
    'CPU_LIMIT=2',
    'MEM_LIMIT=4G',
    'PORT_STEP=20',
    `CONFIG_BASE=${join(dir, 'instances')}`,
    `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
  ].join('\n'));

  const gen = new ComposeGenerator(dir);
  gen.generate(2);

  const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
  const npmMount1 = `${join(dir, 'instances')}/1/.npm:/home/node/.npm`;
  const npmMount2 = `${join(dir, 'instances')}/2/.npm:/home/node/.npm`;
  expect(content).toContain(npmMount1);
  expect(content).toContain(npmMount2);
});

it('does not add .npm mount when ENABLE_NPM_PACKAGES is absent', () => {
  const gen = new ComposeGenerator(dir);
  gen.generate(2);

  const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
  expect(content).not.toContain('.npm:/home/node/.npm');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```

Expected: 4 new tests fail

- [ ] **Step 3: Apply changes in `compose-generator.ts`**

At the top of `generate()`, after reading existing vars, add:

```ts
const openclawImage = vars.OPENCLAW_IMAGE ?? 'openclaw:local';
const enableNpmPackages = vars.ENABLE_NPM_PACKAGES === 'true';
```

In the service template string, replace:

```ts
image: \${OPENCLAW_IMAGE:-openclaw:local}
```

with:

```ts
image: ${openclawImage}
```

After the workspace volume line in the service template, add the npm mount conditionally:

```ts
const npmMount = enableNpmPackages
  ? `      - ${configDir}/.npm:/home/node/.npm\n`
  : '';
```

Then add `${npmMount}` to the volumes section of the service template, after the workspace mount line.

The full volumes section should look like:

```ts
    volumes:
      - ${configDir}:/home/node/.openclaw
      - ${workspaceDir}:/home/node/.openclaw/workspace
${npmMount}
```

(Remove the trailing blank line from `npmMount` when it's empty to avoid extra whitespace.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/server && npx vitest run tests/services/compose-generator.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/compose-generator.ts packages/server/tests/services/compose-generator.test.ts
git commit -m "feat: literal OPENCLAW_IMAGE and optional .npm mount in compose"
```

---

## Task 4: Extract plugin routes to `plugins.ts`, register for both modes

**Files:**
- Create: `packages/server/src/routes/plugins.ts`
- Modify: `packages/server/src/routes/profiles.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/tests/routes/plugins.test.ts`
- Modify: `packages/server/tests/routes/profiles.test.ts`

- [ ] **Step 1: Write failing tests for plugin routes with Docker instance IDs**

Create `packages/server/tests/routes/plugins.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { pluginRoutes } from '../../src/routes/plugins.js';

const mockBackend = {
  execInstanceCommand: vi.fn(),
};

describe('Plugin routes — Docker mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(pluginRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet/:id/plugins returns plugin list for Docker instance', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      JSON.stringify({ workspaceDir: '/tmp/ws', plugins: [{ id: 'feishu', enabled: true }] }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/plugins' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith('openclaw-1', ['plugins', 'list', '--json']);
    expect(res.json().plugins[0].id).toBe('feishu');
  });

  it('GET /api/fleet/:id/plugins rejects invalid Docker instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/invalid_id/plugins' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/:id/plugins/install installs a plugin', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce('Installed plugin: feishu');
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/openclaw-1/plugins/install',
      payload: { spec: '@openclaw/feishu' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith(
      'openclaw-1', ['plugins', 'install', '@openclaw/feishu'],
    );
    expect(res.json().ok).toBe(true);
  });

  it('DELETE /api/fleet/:id/plugins/:pluginId uninstalls a plugin', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce('Removed plugin: feishu');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/fleet/openclaw-1/plugins/feishu',
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith(
      'openclaw-1', ['plugins', 'uninstall', '--force', 'feishu'],
    );
    expect(res.json().ok).toBe(true);
  });

  it('GET tolerates CLI log lines before JSON output', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      '\u001b[35m[plugins]\u001b[0m feishu: Registered\n'
      + '{"workspaceDir":"/tmp/ws","plugins":[{"id":"feishu","enabled":true}]}',
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/plugins' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plugins[0].id).toBe('feishu');
  });
});

describe('Plugin routes — Profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(pluginRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet/:id/plugins works for profile instance id', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      JSON.stringify({ workspaceDir: '/tmp/ws', plugins: [] }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/main/plugins' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/fleet/:id/plugins rejects openclaw-N style id in profile mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/plugins' });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && npx vitest run tests/routes/plugins.test.ts
```

Expected: all tests fail with module not found for `plugins.js`

- [ ] **Step 3: Create `packages/server/src/routes/plugins.ts`**

```ts
// packages/server/src/routes/plugins.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfileAccess } from '../authorize.js';
import { validateInstanceId } from '../validate.js';

const installPluginSchema = z.object({
  spec: z.string().min(1, 'spec is required'),
});

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function parseCliJson(stdout: string): object {
  const ansiStripped = stdout.replace(/\u001b\[[0-9;]*m/g, '');
  const jsonStart = ansiStripped.indexOf('{');
  if (jsonStart < 0) {
    throw new Error('CLI did not return JSON output');
  }
  return JSON.parse(ansiStripped.slice(jsonStart)) as object;
}

export async function pluginRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/api/fleet/:id/plugins',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      try {
        const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'list', '--json']);
        return parseCliJson(stdout);
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_LIST_FAILED' });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/fleet/:id/plugins/install',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      const parsed = installPluginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.errors[0]?.message ?? 'Invalid body',
          code: 'INVALID_BODY',
        });
      }
      try {
        const stdout = await app.backend.execInstanceCommand(
          id, ['plugins', 'install', parsed.data.spec],
        );
        return { ok: true, output: stdout };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_INSTALL_FAILED' });
      }
    },
  );

  app.delete<{ Params: { id: string; pluginId: string } }>(
    '/api/fleet/:id/plugins/:pluginId',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id, pluginId } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!PLUGIN_ID_RE.test(pluginId)) {
        return reply.status(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' });
      }
      try {
        const stdout = await app.backend.execInstanceCommand(
          id, ['plugins', 'uninstall', '--force', pluginId],
        );
        return { ok: true, output: stdout };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_UNINSTALL_FAILED' });
      }
    },
  );
}
```

- [ ] **Step 4: Run plugin tests to verify they pass**

```bash
cd packages/server && npx vitest run tests/routes/plugins.test.ts
```

Expected: all tests pass

- [ ] **Step 5: Remove plugin routes from `profiles.ts`**

In `packages/server/src/routes/profiles.ts`:
- Delete the `parseCliJson` function (moving it to `plugins.ts` above)
- Delete the `PLUGIN_ID_RE` constant
- Delete the `installPluginSchema` constant
- Delete the three plugin route handlers (`GET /api/fleet/:id/plugins`, `POST /api/fleet/:id/plugins/install`, `DELETE /api/fleet/:id/plugins/:pluginId`)

Keep only: `PROFILE_NAME_RE`, `createProfileSchema`, and the three profile CRUD routes (`GET /api/fleet/profiles`, `POST /api/fleet/profiles`, `DELETE /api/fleet/profiles/:name`).

- [ ] **Step 6: Remove plugin route tests from `profiles.test.ts`**

Delete the four plugin route tests from `packages/server/tests/routes/profiles.test.ts`:
- `'GET /api/fleet/:id/plugins returns parsed plugin list'`
- `'GET /api/fleet/:id/plugins tolerates CLI log lines before JSON output'`
- `'POST /api/fleet/:id/plugins/install installs a plugin for the profile'`
- `'DELETE /api/fleet/:id/plugins/:pluginId uninstalls a plugin for the profile'`

- [ ] **Step 7: Register `pluginRoutes` in `index.ts` for both modes**

In `packages/server/src/index.ts`, add the import:

```ts
import { pluginRoutes } from './routes/plugins.js';
```

Register it alongside the other routes (before the profiles-only block):

```ts
await app.register(pluginRoutes);
```

- [ ] **Step 8: Run full server test suite**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass — profiles tests still pass (profile CRUD works), plugins tests pass for both modes

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/routes/plugins.ts packages/server/src/routes/profiles.ts packages/server/src/index.ts packages/server/tests/routes/plugins.test.ts packages/server/tests/routes/profiles.test.ts
git commit -m "feat: extract plugin routes to plugins.ts, register for both Docker and profile modes"
```

---

## Task 5: FleetConfigPanel — OPENCLAW_IMAGE, API key input, npm packages toggle

**Files:**
- Modify: `packages/web/src/components/config/FleetConfigPanel.tsx`

No automated tests for the web — verify manually after changes.

- [ ] **Step 1: Add `openclawImage` to the `fieldLabels` array**

In `FleetConfigPanel.tsx`, add to `fieldLabels`:

```ts
const fieldLabels: [string, string][] = [
  ['BASE_URL', t('baseUrl')],
  ['MODEL_ID', t('modelId')],
  ['OPENCLAW_IMAGE', t('openclawImage')],   // add
  ['CPU_LIMIT', t('cpuLimit')],
  ['MEM_LIMIT', t('memLimit')],
  ['PORT_STEP', t('portStep')],
  ['TZ', t('timezone')],
];
```

Also add the `openclawImage` field to the `useEffect` that syncs data into form state:

```ts
useEffect(() => {
  if (!data) return;
  setForm({
    BASE_URL: data.baseUrl,
    MODEL_ID: data.modelId,
    OPENCLAW_IMAGE: data.openclawImage,   // add
    CPU_LIMIT: data.cpuLimit,
    MEM_LIMIT: data.memLimit,
    PORT_STEP: String(data.portStep),
    TZ: data.tz,
  });
  setScaleCount(data.count);
}, [data]);
```

- [ ] **Step 2: Add API key state and input**

Add state at the top of the component (alongside existing state):

```ts
const [apiKey, setApiKey] = useState('');
```

Update `handleSave` to include `API_KEY` only when the user typed something:

```ts
const handleSave = async () => {
  setError(null);
  try {
    const payload = { ...form, ...(apiKey.trim() ? { API_KEY: apiKey.trim() } : {}) };
    await save(payload);
    setApiKey('');
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  } catch (saveError) {
    setError(saveError instanceof Error ? saveError.message : t('saveFailed'));
  }
};
```

Add the API key input to the `field-grid` section, after the existing `fieldLabels` inputs:

```tsx
<label className="field-label">
  <span>{t('apiKey')}</span>
  <input
    className="text-input mono"
    type="password"
    value={apiKey}
    onChange={(e) => setApiKey(e.target.value)}
    placeholder={t('apiKeyPlaceholder')}
    autoComplete="new-password"
  />
</label>
```

- [ ] **Step 3: Add npm packages toggle**

Add state:

```ts
const [enableNpmPackages, setEnableNpmPackages] = useState(false);
```

Sync from data in the `useEffect`:

```ts
setEnableNpmPackages(data.enableNpmPackages ?? false);
```

Include in save payload:

```ts
const payload = {
  ...form,
  ...(apiKey.trim() ? { API_KEY: apiKey.trim() } : {}),
  ENABLE_NPM_PACKAGES: enableNpmPackages ? 'true' : 'false',
};
```

Add the toggle to the JSX, after the field-grid:

```tsx
<label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
  <input
    type="checkbox"
    checked={enableNpmPackages}
    onChange={(e) => setEnableNpmPackages(e.target.checked)}
  />
  <span>{t('enableNpmPackages')}</span>
</label>
<p className="muted" style={{ marginTop: 0 }}>
  {t('enableNpmPackagesHint')}
</p>
```

- [ ] **Step 4: Add i18n keys**

In `packages/web/src/i18n/locales/en.ts` and `packages/web/src/i18n/locales/zh.ts`, add:

```json
"openclawImage": "Docker Image",
"apiKey": "API Key",
"apiKeyPlaceholder": "leave blank to keep existing",
"enableNpmPackages": "Enable npm packages",
"enableNpmPackagesHint": "Adds a per-instance .npm cache mount. Requires docker compose up -d to apply."
```

For `zh.json`:
```json
"openclawImage": "Docker 镜像",
"apiKey": "API 密钥",
"apiKeyPlaceholder": "留空则保持不变",
"enableNpmPackages": "启用 npm 包支持",
"enableNpmPackagesHint": "为每个实例添加 .npm 缓存挂载。需要重新执行 docker compose up -d 生效。"
```

- [ ] **Step 5: Manual verify**

```bash
npm run dev
```

Open `http://localhost:5173`, navigate to Fleet Config. Verify:
- Docker Image field shows current value
- API Key field is a password input, blank by default, saves only when non-empty
- npm packages toggle saves ENABLE_NPM_PACKAGES to fleet.env

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/config/FleetConfigPanel.tsx packages/web/src/
git commit -m "feat: add OPENCLAW_IMAGE, API key input, and npm packages toggle to Fleet Config panel"
```

---

## Task 6: PluginsTab — remove `instance.profile` guard

**Files:**
- Modify: `packages/web/src/components/instances/PluginsTab.tsx`

- [ ] **Step 1: Remove the profile-mode guard**

In `packages/web/src/components/instances/PluginsTab.tsx`, delete lines 73–79:

```ts
// Delete this block:
if (!instance.profile) {
  return (
    <section className="panel-card">
      <p className="muted">{t('profileModeOnly')}</p>
    </section>
  );
}
```

- [ ] **Step 2: Enable the query unconditionally**

Change line 21:

```ts
// Before:
enabled: Boolean(instance.profile),

// After:
enabled: true,
```

- [ ] **Step 3: Update confirm dialog message to not reference profile**

Line 196 references `instance.profile` in the confirm message:

```ts
// Before:
message={
  pendingRemoval
    ? t('removePluginConfirm', { plugin: pluginLabel(pendingRemoval), profile: instance.profile })
    : ''
}

// After:
message={
  pendingRemoval
    ? t('removePluginConfirm', { plugin: pluginLabel(pendingRemoval), profile: instance.id })
    : ''
}
```

- [ ] **Step 4: Manual verify**

```bash
npm run dev
```

Open a Docker mode instance panel. Verify:
- Plugins tab appears (not "profile mode only")
- Plugin list loads (GET /api/fleet/openclaw-1/plugins)
- Install and uninstall buttons work

- [ ] **Step 5: Run full server tests one final time**

```bash
cd packages/server && npx vitest run
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/instances/PluginsTab.tsx
git commit -m "feat: enable Plugins tab in Docker mode"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Instance config generation (Task 2) — writes minimal `openclaw.json` with gateway token + model config
- ✅ Skip if exists (Task 2) — preserves user customizations
- ✅ Tailscale merge (Task 2) — adds Tailscale fields on top of base config
- ✅ Blank BASE_URL/MODEL_ID omits models block (Task 2)
- ✅ `openclawImage` field (Tasks 1 + 3)
- ✅ `enableNpmPackages` field (Tasks 1 + 3)
- ✅ `.npm` mount when enabled (Task 3)
- ✅ Literal OPENCLAW_IMAGE in compose (Task 3)
- ✅ Plugin routes for both modes (Task 4)
- ✅ Profile CRUD stays profiles-only (Task 4)
- ✅ Fleet Config UI: OPENCLAW_IMAGE, API key, npm toggle (Task 5)
- ✅ PluginsTab ungate (Task 6)

**Type consistency:**
- `FleetConfig.openclawImage` / `FleetConfig.enableNpmPackages` defined in Task 1, used in Tasks 3 and 5 ✅
- `pluginRoutes` exported from `plugins.ts` in Task 4, imported in `index.ts` in Task 4 ✅
- `validateInstanceId(id, app.deploymentMode)` used in `plugins.ts` — `app.deploymentMode` is decorated on the Fastify instance in `index.ts`, type declared in `fastify.d.ts` ✅
