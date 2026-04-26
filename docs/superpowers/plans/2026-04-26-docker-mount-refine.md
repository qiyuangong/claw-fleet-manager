# Docker Mount Refine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stop overlaying `/home/node/.openclaw` in docker-mode containers so OpenClaw's image-installed plugins and runtime layout are not shadowed by host bind mounts; redirect state via `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` and mount the workspace at `/home/node/workspace`.

**Architecture:** Three surgical changes in `packages/server/src/services/`:
1. `docker.ts` switches the default container bind targets to `/home/node/openclaw-state` and `/home/node/workspace`, and injects `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_DIR` into the container env.
2. `docker-instance-provisioning.ts` and `docker-backend.ts` write the new `/home/node/workspace` value into `agents.defaults.workspace` of the generated `openclaw.json` so the gateway points agents at the new mount target.
3. `rewriteManagedBinds` (in `docker.ts`) recognizes both legacy (`/home/node/.openclaw`, `/home/node/.openclaw/workspace`) and new (`/home/node/openclaw-state`, `/home/node/workspace`) targets so existing containers can still be renamed without breaking their mount layout.

Existing running containers keep their old mount layout and old on-disk `openclaw.json`; only newly created instances use the new layout. `provisionDockerInstance` already bails out via `if (existsSync(configFile)) return`, so existing on-disk configs are not rewritten and stay consistent with their already-mounted volumes.

**Tech Stack:** TypeScript, Fastify, dockerode, Vitest

**Out of scope:** `plugins.allow` policy changes (the agent-fleet PR adds `plugins.allow: ["openai"]` for defense-in-depth; current claw-fleet-manager configs ship no `plugins.allow`, and changing that policy is a separate decision). Hermes containers are unaffected — they already use a configurable `HERMES_HOME` mount path, not `.openclaw`.

---

## File Map

| Action | Path | Purpose |
| --- | --- | --- |
| Modify | `packages/server/src/services/docker.ts` | Default bind targets, env vars, `rewriteManagedBinds` legacy compatibility |
| Modify | `packages/server/src/services/docker-instance-provisioning.ts` | New container-internal workspace path in generated `openclaw.json` |
| Modify | `packages/server/src/services/docker-backend.ts` | Same workspace path in the migration write path |
| Modify | `packages/server/tests/services/docker.test.ts` | Assert new bind targets, new env vars, legacy-compat in `rewriteManagedBinds` |
| Modify | `packages/server/tests/services/docker-instance-provisioning.test.ts` | Assert new workspace value |
| Modify | `packages/server/tests/services/docker-backend.test.ts` | Assert new workspace value in migration write |

## Commit Plan

1. `docs: add docker mount refine plan`
2. `refactor(server): redirect docker-mode mounts off /home/node/.openclaw`

The implementation lands in a single behavior commit because the three source files are tightly coupled — splitting them would temporarily mix old and new layouts and break the test suite mid-way.

---

## Task 1: Plan checkpoint

**Files:**
- Create: `docs/superpowers/plans/2026-04-26-docker-mount-refine.md`

- [x] **Step 1.1: Confirm the plan file exists**

Run: `ls docs/superpowers/plans/2026-04-26-docker-mount-refine.md`
Expected: the path is printed.

- [x] **Step 1.2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-04-26-docker-mount-refine.md
git commit -m "docs: add docker mount refine plan"
```

---

## Task 2: Update test for `createManagedContainer` default binds + env vars

**Files:**
- Modify: `packages/server/tests/services/docker.test.ts:153-202`

- [x] **Step 2.1: Replace the bind/env assertions in the existing test**

In `packages/server/tests/services/docker.test.ts`, find the test:

```
it('createManagedContainer creates and starts a hardened managed container with npm cache mount', async () => {
```

Within that test (currently lines 172-200), replace:

```ts
      Env: expect.arrayContaining([
        'HOME=/home/node',
        'TERM=xterm-256color',
        'OPENCLAW_GATEWAY_TOKEN=secret-token',
        'TZ=UTC',
      ]),
      HostConfig: expect.objectContaining({
        Binds: [
          '/tmp/config/team-alpha:/home/node/.openclaw',
          '/tmp/workspace/team-alpha:/home/node/.openclaw/workspace',
          '/tmp/config/team-alpha/.npm:/home/node/.npm',
        ],
```

with:

```ts
      Env: expect.arrayContaining([
        'HOME=/home/node',
        'TERM=xterm-256color',
        'OPENCLAW_GATEWAY_TOKEN=secret-token',
        'TZ=UTC',
        'OPENCLAW_STATE_DIR=/home/node/openclaw-state',
        'OPENCLAW_CONFIG_PATH=/home/node/openclaw-state/openclaw.json',
        'OPENCLAW_WORKSPACE_DIR=/home/node/workspace',
      ]),
      HostConfig: expect.objectContaining({
        Binds: [
          '/tmp/config/team-alpha:/home/node/openclaw-state',
          '/tmp/workspace/team-alpha:/home/node/workspace',
          '/tmp/config/team-alpha/.npm:/home/node/.npm',
        ],
```

- [x] **Step 2.2: Run the test and confirm it fails**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts -t "createManagedContainer creates and starts a hardened managed container"`

Expected: FAIL — the actual `Binds` array still contains `/home/node/.openclaw` and the `Env` array does not yet contain `OPENCLAW_STATE_DIR=...`.

---

## Task 3: Switch default bind targets and add env vars in `docker.ts`

**Files:**
- Modify: `packages/server/src/services/docker.ts:143-172`

- [x] **Step 3.1: Replace the default bind targets**

Edit `packages/server/src/services/docker.ts`. Replace:

```ts
    const binds = spec.binds
      ? [...spec.binds]
      : [
          `${spec.configDir}:/home/node/.openclaw`,
          `${spec.workspaceDir}:/home/node/.openclaw/workspace`,
        ];
```

with:

```ts
    const binds = spec.binds
      ? [...spec.binds]
      : [
          `${spec.configDir}:/home/node/openclaw-state`,
          `${spec.workspaceDir}:/home/node/workspace`,
        ];
```

- [x] **Step 3.2: Inject `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, `OPENCLAW_WORKSPACE_DIR`**

Still in `docker.ts`, replace:

```ts
    const env = [
      'HOME=/home/node',
      'TERM=xterm-256color',
      `TZ=${spec.timezone}`,
      ...(spec.extraEnv ?? []),
    ];
    if (!spec.extraEnv?.some((entry) => entry.startsWith('OPENCLAW_GATEWAY_TOKEN=')) && spec.token) {
      env.splice(2, 0, `OPENCLAW_GATEWAY_TOKEN=${spec.token}`);
    }
```

with:

```ts
    const env = [
      'HOME=/home/node',
      'TERM=xterm-256color',
      `TZ=${spec.timezone}`,
      ...(spec.extraEnv ?? []),
    ];
    if (!spec.extraEnv?.some((entry) => entry.startsWith('OPENCLAW_GATEWAY_TOKEN=')) && spec.token) {
      env.splice(2, 0, `OPENCLAW_GATEWAY_TOKEN=${spec.token}`);
    }
    if (!spec.binds) {
      env.push(
        'OPENCLAW_STATE_DIR=/home/node/openclaw-state',
        'OPENCLAW_CONFIG_PATH=/home/node/openclaw-state/openclaw.json',
        'OPENCLAW_WORKSPACE_DIR=/home/node/workspace',
      );
    }
```

The `if (!spec.binds)` guard scopes the new env vars to the OpenClaw default-mount path. Hermes containers pass an explicit `binds` array (`hermes-docker-backend.ts:137`) and supply their own `extraEnv`; gating on `!spec.binds` keeps Hermes traffic untouched.

- [x] **Step 3.3: Run the test and confirm it passes**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts -t "createManagedContainer creates and starts a hardened managed container"`

Expected: PASS.

- [x] **Step 3.4: Run the rest of `docker.test.ts` and confirm only the rename test still fails**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts`

Expected: the rename test (`recreates a stopped managed container with renamed bind mounts and keeps it stopped`) still passes because it uses legacy targets in its mock inspection — `rewriteManagedBinds` still maps legacy `/home/node/.openclaw` to `spec.configDir`. All other tests should pass.

If any non-rename test fails, stop and re-read the test before proceeding.

---

## Task 4: Add `rewriteManagedBinds` legacy + new target compatibility

**Files:**
- Modify: `packages/server/src/services/docker.ts:316-328`
- Modify: `packages/server/tests/services/docker.test.ts:86-151` (add a sibling test)

- [x] **Step 4.1: Add a failing test for the new-layout rename path**

In `packages/server/tests/services/docker.test.ts`, immediately after the existing test:

```
it('recreates a stopped managed container with renamed bind mounts and keeps it stopped', async () => {
```

(which ends with the `expect(mockReplacementContainer.start).not.toHaveBeenCalled();` assertion), add a new test:

```ts
  it('recreates a stopped managed container preserving new-layout bind targets', async () => {
    mockContainer.inspect.mockResolvedValue({
      Config: {
        Image: 'openclaw:local',
        Labels: {
          'dev.claw-fleet.managed': 'true',
          'dev.claw-fleet.instance-index': '2',
          'dev.claw-fleet.runtime': 'openclaw',
        },
        Env: [
          'HOME=/home/node',
          'OPENCLAW_GATEWAY_TOKEN=secret-token',
          'TZ=UTC',
          'OPENCLAW_STATE_DIR=/home/node/openclaw-state',
          'OPENCLAW_CONFIG_PATH=/home/node/openclaw-state/openclaw.json',
          'OPENCLAW_WORKSPACE_DIR=/home/node/workspace',
        ],
        Cmd: ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789'],
        ExposedPorts: { '18789/tcp': {} },
        Healthcheck: { Test: ['CMD', 'true'] },
      },
      HostConfig: {
        AutoRemove: false,
        Binds: [
          '/tmp/managed/team-alpha/config:/home/node/openclaw-state',
          '/tmp/managed/team-alpha/workspace:/home/node/workspace',
          '/tmp/managed/team-alpha/config/.npm:/home/node/.npm',
        ],
        PortBindings: { '18789/tcp': [{ HostPort: '18809' }] },
        Init: true,
        RestartPolicy: { Name: 'unless-stopped' },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec' },
        NanoCpus: 1500000000,
        Memory: 2147483648,
      },
    });
    mockDocker.createContainer = vi.fn().mockResolvedValue(mockReplacementContainer);

    await svc.recreateStoppedManagedContainer({
      currentName: 'team-alpha',
      nextName: 'team-renamed',
      configDir: '/tmp/managed/team-renamed/config',
      workspaceDir: '/tmp/managed/team-renamed/workspace',
      npmDir: '/tmp/managed/team-renamed/config/.npm',
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      HostConfig: expect.objectContaining({
        Binds: [
          '/tmp/managed/team-renamed/config:/home/node/openclaw-state',
          '/tmp/managed/team-renamed/workspace:/home/node/workspace',
          '/tmp/managed/team-renamed/config/.npm:/home/node/.npm',
        ],
      }),
    }));
  });
```

- [x] **Step 4.2: Run the new test and confirm it fails**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts -t "recreates a stopped managed container preserving new-layout bind targets"`

Expected: FAIL — `rewriteManagedBinds` does not yet recognize the new targets, so it falls through to the `: source` branch and emits the original (pre-rename) host paths.

- [x] **Step 4.3: Extend `rewriteManagedBinds` to recognize both layouts**

In `packages/server/src/services/docker.ts`, replace:

```ts
function rewriteManagedBinds(binds: string[], spec: RecreateManagedContainerSpec): string[] {
  return binds.map((bind) => {
    const [source, target, ...rest] = bind.split(':');
    const nextSource = target === '/home/node/.openclaw'
      ? spec.configDir
      : target === '/home/node/.openclaw/workspace'
        ? spec.workspaceDir
        : target === '/home/node/.npm' && spec.npmDir
          ? spec.npmDir
          : source;
    return [nextSource, target, ...rest].join(':');
  });
}
```

with:

```ts
function rewriteManagedBinds(binds: string[], spec: RecreateManagedContainerSpec): string[] {
  return binds.map((bind) => {
    const [source, target, ...rest] = bind.split(':');
    const nextSource = target === '/home/node/openclaw-state' || target === '/home/node/.openclaw'
      ? spec.configDir
      : target === '/home/node/workspace' || target === '/home/node/.openclaw/workspace'
        ? spec.workspaceDir
        : target === '/home/node/.npm' && spec.npmDir
          ? spec.npmDir
          : source;
    return [nextSource, target, ...rest].join(':');
  });
}
```

This keeps existing legacy containers renaming correctly (their `Binds` still target `/home/node/.openclaw`) while new-layout containers rename correctly too (their `Binds` target `/home/node/openclaw-state`).

- [x] **Step 4.4: Run both rename tests and confirm both pass**

Run: `cd packages/server && npx vitest run tests/services/docker.test.ts -t "recreates a stopped managed container"`

Expected: both rename tests PASS — the legacy one preserves `/home/node/.openclaw` targets, the new-layout one preserves `/home/node/openclaw-state` targets.

---

## Task 5: Update `agents.defaults.workspace` in `docker-instance-provisioning.ts`

**Files:**
- Modify: `packages/server/tests/services/docker-instance-provisioning.test.ts:40`
- Modify: `packages/server/src/services/docker-instance-provisioning.ts:69`

- [x] **Step 5.1: Update the assertion**

In `packages/server/tests/services/docker-instance-provisioning.test.ts`, replace:

```ts
    expect(config.agents.defaults.workspace).toBe('/home/node/.openclaw/workspace');
```

with:

```ts
    expect(config.agents.defaults.workspace).toBe('/home/node/workspace');
```

- [x] **Step 5.2: Run the test and confirm it fails**

Run: `cd packages/server && npx vitest run tests/services/docker-instance-provisioning.test.ts`

Expected: FAIL on the updated assertion.

- [x] **Step 5.3: Update the implementation**

In `packages/server/src/services/docker-instance-provisioning.ts`, replace:

```ts
    agents: {
      defaults: {
        workspace: '/home/node/.openclaw/workspace',
      },
    },
```

with:

```ts
    agents: {
      defaults: {
        workspace: '/home/node/workspace',
      },
    },
```

- [x] **Step 5.4: Run the test and confirm it passes**

Run: `cd packages/server && npx vitest run tests/services/docker-instance-provisioning.test.ts`

Expected: PASS.

---

## Task 6: Update `agents.defaults.workspace` in `docker-backend.ts`

**Files:**
- Modify: `packages/server/tests/services/docker-backend.test.ts:493`
- Modify: `packages/server/src/services/docker-backend.ts:367`

- [x] **Step 6.1: Update the assertion**

In `packages/server/tests/services/docker-backend.test.ts`, replace:

```ts
    expect(written.agents.defaults.workspace).toBe('/home/node/.openclaw/workspace');
```

with:

```ts
    expect(written.agents.defaults.workspace).toBe('/home/node/workspace');
```

- [x] **Step 6.2: Run the test and confirm it fails**

Run: `cd packages/server && npx vitest run tests/services/docker-backend.test.ts -t "createInstanceFromMigration() writes Docker openclaw.json"`

Expected: FAIL on the updated assertion.

- [x] **Step 6.3: Update the implementation**

In `packages/server/src/services/docker-backend.ts`, replace:

```ts
      agents: {
        defaults: { workspace: '/home/node/.openclaw/workspace' },
      },
```

with:

```ts
      agents: {
        defaults: { workspace: '/home/node/workspace' },
      },
```

- [x] **Step 6.4: Run the test and confirm it passes**

Run: `cd packages/server && npx vitest run tests/services/docker-backend.test.ts -t "createInstanceFromMigration() writes Docker openclaw.json"`

Expected: PASS.

---

## Task 7: Full server suite + lint

**Files:** none modified.

- [x] **Step 7.1: Run the full server vitest suite**

Run: `cd packages/server && npx vitest run`

Expected: all tests pass, including `fleet.test.ts`, `instances.test.ts`, and the three suites this plan touched.

- [x] **Step 7.2: Run lint at the workspace root**

Run: `npm run lint`

Expected: zero errors. If type-only diagnostics appear in unrelated files, stop and surface them — do not paper over them.

- [x] **Step 7.3: Run the workspace `npm run test` for parity with CI**

Run: `npm run test`

Expected: turbo runs all packages' test scripts and they all pass.

---

## Task 8: Commit

**Files:** none modified.

- [x] **Step 8.1: Stage the source and test changes**

```bash
git add \
  packages/server/src/services/docker.ts \
  packages/server/src/services/docker-instance-provisioning.ts \
  packages/server/src/services/docker-backend.ts \
  packages/server/tests/services/docker.test.ts \
  packages/server/tests/services/docker-instance-provisioning.test.ts \
  packages/server/tests/services/docker-backend.test.ts
```

- [x] **Step 8.2: Create the commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(server): redirect docker-mode mounts off /home/node/.openclaw

Mount per-instance state at /home/node/openclaw-state and per-instance
workspace at /home/node/workspace, and pass OPENCLAW_STATE_DIR /
OPENCLAW_CONFIG_PATH / OPENCLAW_WORKSPACE_DIR so OpenClaw resolves them
without overlaying its own .openclaw directory. Mirrors the layout in
sii-system/agent-fleet#23. rewriteManagedBinds accepts both legacy and
new targets so existing containers keep renaming cleanly.
EOF
)"
```

- [x] **Step 8.3: Verify the working tree is clean**

Run: `git status`

Expected: `nothing to commit, working tree clean`.

---

## Migration Notes (for the PR description, not for code)

- **Existing running containers** keep their old `Binds` (`/home/node/.openclaw`, `/home/node/.openclaw/workspace`) and old on-disk `openclaw.json` (`agents.defaults.workspace = /home/node/.openclaw/workspace`). They are not touched by this change. Their layout remains internally consistent.
- **Newly created containers** use the new layout end-to-end: new bind targets, new env vars, and new `agents.defaults.workspace` value.
- **Renaming** an existing legacy container still works because `rewriteManagedBinds` continues to recognize the legacy targets. Renaming a new-layout container also works for the same reason.
- **Manually deleting an existing instance's `openclaw.json`** would cause `provisionDockerInstance` to regenerate it with the new workspace path while the container still has legacy binds — surface this caveat in the PR description so operators know not to do that without also recreating the container.
- **OpenClaw image compatibility:** the redirection contract (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`) is implemented in `openclaw/src/utils.ts:140-147` (verified during planning) and has shipped in OpenClaw for some time, so the default `openclaw:local` and any reasonably current pinned tag will honor it. If a deploy pins an older image that predates these env vars, that pin needs to bump alongside this PR.
