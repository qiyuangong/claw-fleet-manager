# Instance Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only in-place rename flow for both profile and Docker instances, requiring the source instance to be stopped and preserving runtime assets and user assignments.

**Architecture:** Extend the shared backend contract with `renameInstance(id, nextName)`, let `HybridBackend` orchestrate ownership resolution plus user-assignment rewrites, and keep the actual rename mechanics inside `ProfileBackend` and `DockerBackend`. Expose the feature through `POST /api/fleet/instances/:id/rename` and a new rename dialog in the instance management UI.

**Tech Stack:** TypeScript, Fastify, Vitest, React 19, React Query, Zustand, i18next

---

## File Map

| File | Change |
|---|---|
| `packages/server/src/services/backend.ts` | Add `renameInstance()` to `DeploymentBackend` |
| `packages/server/src/services/user.ts` | Add helper to replace assigned profile ids during rename |
| `packages/server/tests/services/user.test.ts` | Add rename-assignment tests |
| `packages/server/src/services/hybrid-backend.ts` | Inject `UserService`; add rename orchestration and conflict checks |
| `packages/server/tests/services/hybrid-backend.test.ts` | Add rename orchestration tests |
| `packages/server/src/services/profile-backend.ts` | Add stop-only in-place profile rename implementation |
| `packages/server/tests/services/profile-backend.test.ts` | Add profile rename tests |
| `packages/server/src/services/docker.ts` | Add a container rename helper |
| `packages/server/src/services/docker-backend.ts` | Add stop-only in-place Docker rename implementation |
| `packages/server/tests/services/docker-backend.test.ts` | Add Docker rename tests |
| `packages/server/src/routes/fleet.ts` | Add `POST /api/fleet/instances/:id/rename` |
| `packages/server/tests/routes/fleet.test.ts` | Add route tests for rename |
| `packages/server/src/index.ts` | Pass `UserService` into `HybridBackend` |
| `packages/web/src/api/fleet.ts` | Add `renameInstance()` client |
| `packages/web/src/components/instances/RenameInstanceDialog.tsx` | Create rename dialog |
| `packages/web/src/components/instances/InstanceManagementPanel.tsx` | Add Rename action and selection update |
| `packages/web/tests/RenameInstanceDialog.test.tsx` | Create dialog tests |
| `packages/web/tests/InstanceManagementPanel.test.tsx` | Create management panel rename-flow tests |
| `packages/web/src/i18n/locales/en.ts` | Add rename labels/messages |
| `packages/web/src/i18n/locales/zh.ts` | Add rename labels/messages |

---

## Task 1: Shared Contract and User Assignment Rewrite

**Files:**
- Modify: `packages/server/src/services/backend.ts`
- Modify: `packages/server/src/services/user.ts`
- Modify: `packages/server/tests/services/user.test.ts`

- [ ] **Step 1: Write the failing user-service tests**

Add this block near the end of `packages/server/tests/services/user.test.ts`:

```ts
describe('UserService.renameAssignedProfile', () => {
  it('replaces matching assigned profile ids across users', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.create('bob', 'password123', 'user');

    await svc.setAssignedProfiles('alice', ['team-alpha', 'team-beta']);
    await svc.setAssignedProfiles('bob', ['team-gamma']);

    await svc.renameAssignedProfile('team-alpha', 'team-delta');

    expect(svc.get('alice')?.assignedProfiles).toEqual(['team-delta', 'team-beta']);
    expect(svc.get('bob')?.assignedProfiles).toEqual(['team-gamma']);
  });

  it('evicts cached verify results after renaming assignments', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.setAssignedProfiles('alice', ['team-alpha']);

    const before = await svc.verify('alice', 'password123');
    expect(before?.assignedProfiles).toEqual(['team-alpha']);

    await svc.renameAssignedProfile('team-alpha', 'team-delta');

    const after = await svc.verify('alice', 'password123');
    expect(after?.assignedProfiles).toEqual(['team-delta']);
  });
});
```

- [ ] **Step 2: Run the user-service tests to verify red**

Run:

```bash
cd packages/server && npx vitest run tests/services/user.test.ts
```

Expected: FAIL with `renameAssignedProfile is not a function`.

- [ ] **Step 3: Extend the backend contract**

In `packages/server/src/services/backend.ts`, add the new method under the scaling/management section:

```ts
  createInstance(opts: CreateInstanceOpts): Promise<FleetInstance>;
  removeInstance(id: string): Promise<void>;
  renameInstance(id: string, nextName: string): Promise<FleetInstance>;
```

- [ ] **Step 4: Implement the user assignment rewrite**

In `packages/server/src/services/user.ts`, add this method after `setAssignedProfiles`:

```ts
  async renameAssignedProfile(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return;

    let changed = false;
    for (const user of this.users) {
      const nextProfiles = user.assignedProfiles.map((profile) => {
        if (profile !== oldId) return profile;
        changed = true;
        return newId;
      });
      user.assignedProfiles = Array.from(new Set(nextProfiles));
    }

    if (!changed) return;
    this.evictCache();
    this.persist();
  }
```

- [ ] **Step 5: Run the user-service tests to verify green**

Run:

```bash
cd packages/server && npx vitest run tests/services/user.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/backend.ts \
  packages/server/src/services/user.ts \
  packages/server/tests/services/user.test.ts
git commit -m "feat: add rename assignment support"
```

---

## Task 2: `HybridBackend` Rename Orchestration

**Files:**
- Modify: `packages/server/src/services/hybrid-backend.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/tests/services/hybrid-backend.test.ts`

- [ ] **Step 1: Write the failing hybrid-backend tests**

Add a `renameInstance` block to `packages/server/tests/services/hybrid-backend.test.ts`:

```ts
describe('renameInstance', () => {
  const renamedProfileInstance = { ...profileInstance, id: 'team-delta', profile: 'team-delta', status: 'stopped' as const, pid: undefined };
  const userService = { renameAssignedProfile: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    (profileBackend as any).renameInstance = vi.fn().mockResolvedValue(renamedProfileInstance);
    (dockerBackend as any).renameInstance = vi.fn();
    backend = new HybridBackend(dockerBackend as any, profileBackend as any, userService as any);
  });

  it('routes rename to the owning backend and rewrites assignments', async () => {
    profileBackend.refresh.mockResolvedValue({
      instances: [renamedProfileInstance],
      totalRunning: 0,
      updatedAt: 3000,
    });

    const result = await backend.renameInstance('team-alpha', 'team-delta');

    expect((profileBackend as any).renameInstance).toHaveBeenCalledWith('team-alpha', 'team-delta');
    expect(userService.renameAssignedProfile).toHaveBeenCalledWith('team-alpha', 'team-delta');
    expect(result.id).toBe('team-delta');
  });

  it('rejects target names that already exist in the other backend', async () => {
    await expect(backend.renameInstance('team-alpha', 'openclaw-1')).rejects.toThrow(/already exists/i);
    expect((profileBackend as any).renameInstance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the hybrid-backend tests to verify red**

Run:

```bash
cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts
```

Expected: FAIL because `HybridBackend` does not accept `userService` and has no `renameInstance`.

- [ ] **Step 3: Update `HybridBackend` constructor wiring**

In `packages/server/src/services/hybrid-backend.ts`, change the constructor and add the import:

```ts
import type { UserService } from './user.js';

  constructor(
    private dockerBackend: DockerBackend,
    private profileBackend: ProfileBackend,
    private userService: UserService,
  ) {}
```

Update `packages/server/src/index.ts` to pass the new dependency:

```ts
const backend = new HybridBackend(dockerBackend, profileBackend, userService);
```

- [ ] **Step 4: Implement rename orchestration**

In `packages/server/src/services/hybrid-backend.ts`, add:

```ts
  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (id === nextName) {
      throw new Error(`Instance "${id}" already uses that name`);
    }

    await this.ensureInstanceIdAvailable(nextName);
    const backend = await this.backendForId(id);
    await backend.renameInstance(id, nextName);
    await this.userService.renameAssignedProfile(id, nextName);

    const status = await this.refresh();
    const instance = status.instances.find((item) => item.id === nextName);
    if (!instance) throw new Error(`Instance "${nextName}" not found after rename`);
    return instance;
  }
```

- [ ] **Step 5: Run the hybrid-backend tests to verify green**

Run:

```bash
cd packages/server && npx vitest run tests/services/hybrid-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/hybrid-backend.ts \
  packages/server/src/index.ts \
  packages/server/tests/services/hybrid-backend.test.ts
git commit -m "feat: add hybrid backend rename orchestration"
```

---

## Task 3: Stop-Only In-Place Profile Rename

**Files:**
- Modify: `packages/server/src/services/profile-backend.ts`
- Modify: `packages/server/tests/services/profile-backend.test.ts`

- [ ] **Step 1: Write the failing profile-backend tests**

Add this block to `packages/server/tests/services/profile-backend.test.ts`:

```ts
describe('ProfileBackend.renameInstance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/tmp/fleet/profiles.json')) {
        return JSON.stringify({
          profiles: {
            'team-alpha': {
              name: 'team-alpha',
              port: 18789,
              pid: null,
              configPath: '/tmp/configs/team-alpha/openclaw.json',
              stateDir: '/tmp/states/team-alpha',
            },
          },
          nextPort: 18809,
        });
      }
      if (String(path).endsWith('/tmp/configs/team-alpha/openclaw.json')) {
        return JSON.stringify({ agents: { defaults: { workspace: '/tmp/states/team-alpha/workspace' } }, gateway: { auth: { token: 'tok' } } });
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  it('renames registry entry and rewrites workspace path', async () => {
    const backend = makeBackend();
    await backend.initialize();

    await backend.renameInstance('team-alpha', 'team-delta');

    expect(fs.renameSync).toHaveBeenCalledWith('/tmp/states/team-alpha', '/tmp/states/team-delta');
    expect(fs.renameSync).toHaveBeenCalledWith('/tmp/configs/team-alpha', '/tmp/configs/team-delta');
    const configWrite = vi.mocked(fs.writeFileSync).mock.calls.find(([path]) =>
      String(path).endsWith('/tmp/configs/team-delta/openclaw.json.tmp'));
    expect(configWrite).toBeTruthy();
    expect(String(configWrite?.[1])).toContain('/tmp/states/team-delta/workspace');
  });

  it('rejects rename when the profile is still running', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/tmp/fleet/profiles.json')) {
        return JSON.stringify({
          profiles: {
            'team-alpha': {
              name: 'team-alpha',
              port: 18789,
              pid: 4242,
              configPath: '/tmp/configs/team-alpha/openclaw.json',
              stateDir: '/tmp/states/team-alpha',
            },
          },
          nextPort: 18809,
        });
      }
      if (String(path).endsWith('/tmp/configs/team-alpha/openclaw.json')) {
        return JSON.stringify({ agents: { defaults: { workspace: '/tmp/states/team-alpha/workspace' } } });
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const backend = makeBackend();
    await backend.initialize();

    await expect(backend.renameInstance('team-alpha', 'team-delta')).rejects.toThrow(/stop/i);
  });
});
```

- [ ] **Step 2: Run the profile-backend tests to verify red**

Run:

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts
```

Expected: FAIL because `renameInstance` is missing.

- [ ] **Step 3: Add filesystem imports needed for directory rename**

Update the `node:path` import in `packages/server/src/services/profile-backend.ts` so the implementation can compute sibling directories cleanly:

```ts
import { join, dirname } from 'node:path';
```

- [ ] **Step 4: Implement `renameInstance` in `ProfileBackend`**

Add this method near the other lifecycle/management methods:

```ts
  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    if (entry.pid !== null || this.instanceStatus.get(id) === 'running') {
      throw new Error(`Profile "${id}" must be stopped before rename`);
    }
    if (!isValidManagedProfileName(nextName)) {
      throw new Error(getManagedProfileNameError(nextName));
    }
    if (this.registry.profiles[nextName]) {
      throw new Error(`Profile "${nextName}" already exists`);
    }

    const nextStateDir = join(dirname(entry.stateDir), nextName);
    const nextConfigDir = join(dirname(dirname(entry.configPath)), nextName);
    const nextConfigPath = join(nextConfigDir, 'openclaw.json');

    renameSync(entry.stateDir, nextStateDir);
    renameSync(dirname(entry.configPath), nextConfigDir);

    const config = JSON.parse(readFileSync(nextConfigPath, 'utf-8')) as ProfileConfig;
    config.agents ??= {};
    config.agents.defaults ??= {};
    config.agents.defaults.workspace = join(nextStateDir, 'workspace');
    const tmpPath = `${nextConfigPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, nextConfigPath);

    delete this.registry.profiles[id];
    this.instanceStatus.delete(id);
    this.processStartTimes.delete(id);
    this.registry.profiles[nextName] = { ...entry, name: nextName, stateDir: nextStateDir, configPath: nextConfigPath };
    this.instanceStatus.set(nextName, 'stopped');
    this.saveRegistry();

    await this.refresh();
    const instance = this.cache?.instances.find((item) => item.id === nextName);
    if (!instance) throw new Error(`Instance "${nextName}" not found after rename`);
    return instance;
  }
```

- [ ] **Step 5: Run the profile-backend tests to verify green**

Run:

```bash
cd packages/server && npx vitest run tests/services/profile-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/profile-backend.ts \
  packages/server/tests/services/profile-backend.test.ts
git commit -m "feat: add profile instance rename"
```

---

## Task 4: Docker Service and Docker Backend Rename

**Files:**
- Modify: `packages/server/src/services/docker.ts`
- Modify: `packages/server/src/services/docker-backend.ts`
- Modify: `packages/server/tests/services/docker-backend.test.ts`

- [ ] **Step 1: Write the failing Docker rename tests**

Add this block to `packages/server/tests/services/docker-backend.test.ts`:

```ts
it('renameInstance() renames stopped Docker instances in place', async () => {
  mockDocker.listFleetContainers.mockResolvedValue([
    { name: 'team-alpha', id: 'a', state: 'exited', index: 2 },
  ]);
  mockDocker.inspectContainer.mockResolvedValue({ status: 'exited', health: 'none', image: 'openclaw:local', uptime: 0 });
  mockFleetConfig.readTokens.mockReturnValue({ 2: 'token-abc123' });

  const instance = await backend.renameInstance('team-alpha', 'team-delta');

  expect(mockDocker.renameContainer).toHaveBeenCalledWith('team-alpha', 'team-delta');
  expect(mockFsRenameSync).toHaveBeenCalledWith('/tmp/managed/team-alpha', '/tmp/managed/team-delta');
  expect(instance.id).toBe('team-delta');
});

it('renameInstance() rejects running Docker instances', async () => {
  mockDocker.listFleetContainers.mockResolvedValue([
    { name: 'team-alpha', id: 'a', state: 'running', index: 2 },
  ]);

  await expect(backend.renameInstance('team-alpha', 'team-delta')).rejects.toThrow(/stop/i);
});
```

At the top of the file, alias the mocked fs rename helper:

```ts
import { mkdirSync, writeFileSync, renameSync as mockFsRenameSync } from 'node:fs';
```

And extend the `vi.mock('node:fs', ...)` factory in the same file:

```ts
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));
```

And extend `mockDocker`:

```ts
  renameContainer: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: Run the Docker backend tests to verify red**

Run:

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: FAIL because `renameContainer` and `renameInstance` do not exist.

- [ ] **Step 3: Add the Docker service helper**

In `packages/server/src/services/docker.ts`, add:

```ts
  async renameContainer(currentName: string, nextName: string): Promise<void> {
    await this.docker.getContainer(currentName).rename({ name: nextName });
  }
```

- [ ] **Step 4: Implement Docker in-place rename**

In `packages/server/src/services/docker-backend.ts`, import `renameSync` from `node:fs` and add:

```ts
  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (!MANAGED_INSTANCE_ID_RE.test(nextName)) {
      throw new Error('name must be lowercase alphanumeric with hyphens');
    }

    const container = await this.findContainer(id);
    if (!container) throw new Error(`Instance "${id}" not found`);
    if (container.state === 'running') {
      throw new Error(`Instance "${id}" must be stopped before rename`);
    }

    const existing = await this.findContainer(nextName);
    if (existing) throw new Error(`Instance "${nextName}" already exists`);

    renameSync(this.fleetConfig.getDockerInstanceRoot(id), this.fleetConfig.getDockerInstanceRoot(nextName));
    await this.docker.renameContainer(id, nextName);

    const status = await this.refresh();
    const instance = status.instances.find((item) => item.id === nextName);
    if (!instance) throw new Error(`Instance "${nextName}" not found after rename`);
    return instance;
  }
```

If `FleetConfigService.getDockerInstanceRoot()` is not already public enough for your usage, keep using it directly; it already exists.

- [ ] **Step 5: Run the Docker backend tests to verify green**

Run:

```bash
cd packages/server && npx vitest run tests/services/docker-backend.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/docker.ts \
  packages/server/src/services/docker-backend.ts \
  packages/server/tests/services/docker-backend.test.ts
git commit -m "feat: add docker instance rename"
```

---

## Task 5: Fleet Route for Rename

**Files:**
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`

- [ ] **Step 1: Write the failing route tests**

Add these tests to `packages/server/tests/routes/fleet.test.ts` and extend `mockBackend` with `renameInstance: vi.fn()`:

```ts
it('POST /api/fleet/instances/:id/rename renames an instance', async () => {
  mockBackend.renameInstance.mockResolvedValue({ ...mockStatus.instances[0], id: 'team-delta' });

  const res = await app.inject({
    method: 'POST',
    url: '/api/fleet/instances/team-alpha/rename',
    payload: { name: 'team-delta' },
  });

  expect(res.statusCode).toBe(200);
  expect(mockBackend.renameInstance).toHaveBeenCalledWith('team-alpha', 'team-delta');
});

it('POST /api/fleet/instances/:id/rename validates the new name', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/fleet/instances/team-alpha/rename',
    payload: { name: 'BAD_NAME' },
  });

  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('INVALID_NAME');
});
```

- [ ] **Step 2: Run the fleet route tests to verify red**

Run:

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add the rename schema and handler**

In `packages/server/src/routes/fleet.ts`, add:

```ts
const renameInstanceSchema = z.object({
  name: z.string().min(1),
});
```

And register the route:

```ts
  app.post<{ Params: { id: string } }>('/api/fleet/instances/:id/rename', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Fleet'],
      summary: 'Rename a fleet instance',
      params: instanceIdParamsSchema,
      body: {
        type: 'object',
        properties: { name: { type: 'string', minLength: 1 } },
        required: ['name'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }

    const parsed = renameInstanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }

    const nextName = parsed.data.name.trim();
    if (!MANAGED_INSTANCE_ID_RE.test(nextName)) {
      return reply.status(400).send({ error: 'name must be lowercase alphanumeric with hyphens', code: 'INVALID_NAME' });
    }

    try {
      return await app.backend.renameInstance(id, nextName);
    } catch (error: unknown) {
      const message = safeError(error);
      const statusCode = /not found/i.test(message) ? 404 : /already exists|must be stopped|already uses that name/i.test(message) ? 409 : 500;
      const code = /must be stopped/i.test(message) ? 'RENAME_REQUIRES_STOP' : /already exists/i.test(message) ? 'RENAME_CONFLICT' : /not found/i.test(message) ? 'INSTANCE_NOT_FOUND' : 'RENAME_FAILED';
      return reply.status(statusCode).send({ error: message, code });
    }
  });
```

- [ ] **Step 4: Run the fleet route tests to verify green**

Run:

```bash
cd packages/server && npx vitest run tests/routes/fleet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/fleet.ts \
  packages/server/tests/routes/fleet.test.ts
git commit -m "feat: add fleet rename endpoint"
```

---

## Task 6: Web API and Rename Dialog

**Files:**
- Modify: `packages/web/src/api/fleet.ts`
- Create: `packages/web/src/components/instances/RenameInstanceDialog.tsx`
- Create: `packages/web/tests/RenameInstanceDialog.test.tsx`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`

- [ ] **Step 1: Write the failing dialog test**

Create `packages/web/tests/RenameInstanceDialog.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameInstanceDialog } from '../src/components/instances/RenameInstanceDialog';

const renameInstanceMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('../src/api/fleet', () => ({
  renameInstance: (...args: unknown[]) => renameInstanceMock(...args),
}));

it('submits a sanitized name and invalidates fleet and users queries', async () => {
  renameInstanceMock.mockResolvedValue({ id: 'team-delta' });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(invalidateQueriesMock);

  render(
    <QueryClientProvider client={queryClient}>
      <RenameInstanceDialog instanceId="team-alpha" onClose={() => {}} onRenamed={() => {}} />
    </QueryClientProvider>,
  );

  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('renameInstanceName'));
  await user.type(screen.getByLabelText('renameInstanceName'), 'Team-Delta');
  await user.click(screen.getByRole('button', { name: 'renameInstanceCta' }));

  await waitFor(() => {
    expect(renameInstanceMock).toHaveBeenCalledWith('team-alpha', 'team-delta');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['fleet'] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['users'] });
  });
});
```

- [ ] **Step 2: Run the dialog test to verify red**

Run:

```bash
cd packages/web && npx vitest run tests/RenameInstanceDialog.test.tsx
```

Expected: FAIL because the component and API helper do not exist.

- [ ] **Step 3: Add the API helper and translations**

In `packages/web/src/api/fleet.ts`, add:

```ts
export const renameInstance = (id: string, name: string) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
```

Add these i18n keys in both locale files:

```ts
  renameInstance: 'Rename',
  renameInstanceTitle: 'Rename Instance',
  renameInstanceHelp: 'Change the managed instance id. The instance must be stopped first.',
  renameInstanceName: 'New instance name',
  renameInstancePlaceholder: 'team-delta',
  renameInstanceCta: 'Rename Instance',
  renaming: 'Renaming...',
```

- [ ] **Step 4: Create the dialog with the minimal mutation flow**

Create `packages/web/src/components/instances/RenameInstanceDialog.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { renameInstance } from '../../api/fleet';

export function RenameInstanceDialog({
  instanceId,
  onClose,
  onRenamed,
}: {
  instanceId: string;
  onClose: () => void;
  onRenamed: (nextId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(instanceId);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (nextName: string) => renameInstance(instanceId, nextName),
    onSuccess: async (instance) => {
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onRenamed(instance.id);
      onClose();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : t('renameInstanceFailed'));
    },
  });

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
        <h2>{t('renameInstanceTitle')}</h2>
        <p className="muted">{t('renameInstanceHelp')}</p>
        <label className="field-label">
          <span>{t('renameInstanceName')}</span>
          <input
            aria-label="renameInstanceName"
            className="text-input"
            value={name}
            placeholder={t('renameInstancePlaceholder')}
            onChange={(event) => setName(event.target.value.toLowerCase())}
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>{t('cancel')}</button>
          <button
            className="primary-button"
            disabled={mutation.isPending || !name.trim()}
            onClick={() => mutation.mutate(name.trim())}
          >
            {mutation.isPending ? t('renaming') : t('renameInstanceCta')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the dialog test to verify green**

Run:

```bash
cd packages/web && npx vitest run tests/RenameInstanceDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/fleet.ts \
  packages/web/src/components/instances/RenameInstanceDialog.tsx \
  packages/web/tests/RenameInstanceDialog.test.tsx \
  packages/web/src/i18n/locales/en.ts \
  packages/web/src/i18n/locales/zh.ts
git commit -m "feat: add rename dialog"
```

---

## Task 7: Instance Management Integration

**Files:**
- Modify: `packages/web/src/components/instances/InstanceManagementPanel.tsx`
- Create: `packages/web/tests/InstanceManagementPanel.test.tsx`
- Modify: `packages/web/src/store.ts` (only if a helper improves selection update clarity)

- [ ] **Step 1: Write the failing panel integration test**

Create `packages/web/tests/InstanceManagementPanel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InstanceManagementPanel } from '../src/components/instances/InstanceManagementPanel';
import { useAppStore } from '../src/store';

vi.mock('../src/hooks/useFleet', () => ({
  useFleet: () => ({
    isLoading: false,
    data: {
      instances: [
        { id: 'team-alpha', mode: 'profile', status: 'stopped', health: 'healthy', port: 18789, pid: undefined },
      ],
    },
  }),
}));

vi.mock('../src/components/instances/RenameInstanceDialog', () => ({
  RenameInstanceDialog: ({ onRenamed }: { onRenamed: (nextId: string) => void }) => (
    <button onClick={() => onRenamed('team-delta')}>mock-confirm-rename</button>
  ),
}));

it('updates the selected instance when the active row is renamed', async () => {
  useAppStore.setState({
    currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    activeView: { type: 'instance', id: 'team-alpha' },
    activeTab: 'overview',
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InstanceManagementPanel onOpenInstance={() => {}} />
    </QueryClientProvider>,
  );

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'renameInstance' }));
  await user.click(screen.getByRole('button', { name: 'mock-confirm-rename' }));

  expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'team-delta' });
});
```

- [ ] **Step 2: Run the panel test to verify red**

Run:

```bash
cd packages/web && npx vitest run tests/InstanceManagementPanel.test.tsx
```

Expected: FAIL because the Rename action is not wired into the panel.

- [ ] **Step 3: Integrate the Rename action**

In `packages/web/src/components/instances/InstanceManagementPanel.tsx`, add local state and the button:

```tsx
  const selectedInstanceId = useAppStore((state) => state.activeView.type === 'instance' ? state.activeView.id : null);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const [pendingRename, setPendingRename] = useState<string | null>(null);
```

Add the action button in the row:

```tsx
                      <button
                        className="secondary-button"
                        onClick={() => setPendingRename(instance.id)}
                      >
                        {t('renameInstance')}
                      </button>
```

Add the dialog near the bottom:

```tsx
      {pendingRename ? (
        <RenameInstanceDialog
          instanceId={pendingRename}
          onClose={() => setPendingRename(null)}
          onRenamed={(nextId) => {
            if (selectedInstanceId === pendingRename) {
              selectInstance(nextId);
            }
            setPendingRename(null);
          }}
        />
      ) : null}
```

- [ ] **Step 4: Run the panel test to verify green**

Run:

```bash
cd packages/web && npx vitest run tests/InstanceManagementPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/instances/InstanceManagementPanel.tsx \
  packages/web/tests/InstanceManagementPanel.test.tsx
git commit -m "feat: wire rename into instance management"
```

---

## Task 8: Focused Verification

**Files:**
- No code changes expected

- [ ] **Step 1: Run the focused server test suite**

Run:

```bash
cd packages/server && npx vitest run \
  tests/services/user.test.ts \
  tests/services/hybrid-backend.test.ts \
  tests/services/profile-backend.test.ts \
  tests/services/docker-backend.test.ts \
  tests/routes/fleet.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the focused web test suite**

Run:

```bash
cd packages/web && npx vitest run \
  tests/RenameInstanceDialog.test.tsx \
  tests/InstanceManagementPanel.test.tsx \
  tests/AddInstanceDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the repo lint/build checks that cover touched areas**

Run:

```bash
npm run build
npm run lint
```

Expected: successful build and lint.

- [ ] **Step 4: Commit the verification checkpoint**

```bash
git add -A
git commit -m "test: verify instance rename feature"
```

---

## Self-Review

- Spec coverage:
  - Shared rename API: Task 5
  - Hybrid orchestration and user assignment rewrite: Tasks 1-2
  - Profile rename behavior: Task 3
  - Docker rename behavior: Task 4
  - UI and selection handling: Tasks 6-7
  - Verification: Task 8
- Placeholder scan: no `TODO`/`TBD` placeholders remain; every task includes exact files, commands, and code snippets.
- Type consistency:
  - Backend method name is consistently `renameInstance`
  - User-service helper is consistently `renameAssignedProfile`
  - Web API helper is consistently `renameInstance`
