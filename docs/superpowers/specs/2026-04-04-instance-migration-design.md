# Instance Migration Design

**Date:** 2026-04-04
**Branch:** dockermodeenhance

## Overview

Allow fleet instances to be migrated between Docker and profile modes without losing workspace data. Migration preserves the workspace directory in-place and carries the gateway token to the new instance. The feature is available only in hybrid deployment mode and only to admin users.

---

## Section 1: API

### Endpoint

```
POST /api/fleet/instances/:id/migrate
```

**Auth:** `requireAdmin`

**Body:**
```json
{
  "targetMode": "docker" | "profile",
  "deleteSource": false
}
```
- `targetMode` — required; must differ from the source instance's current mode
- `deleteSource` — optional, default `false`; if `true`, removes the source instance after successful migration

**Response (200):** The new `FleetInstance` object (same shape as `POST /api/fleet/instances`)

**Error responses:**

| Code | HTTP | Meaning |
|---|---|---|
| `MODE_UNAVAILABLE` | 400 | Server is not in hybrid deployment mode |
| `INSTANCE_NOT_FOUND` | 404 | No instance with the given id |
| `ALREADY_TARGET_MODE` | 400 | Source instance is already in `targetMode` |
| `MIGRATE_FAILED` | 500 | Migration failed partway through |

**New file:** `packages/server/src/routes/migrate.ts`

---

## Section 2: Migration Logic

### Location

Migration is implemented as `migrate(id, opts)` on `HybridBackend`. It already holds references to both `DockerBackend` and `ProfileBackend` and is the natural place to coordinate cross-backend operations.

### What is preserved

- **Workspace directory** — reused in-place; the new instance's bind-mount or stateDir points at the same host path
- **Gateway token** — read from the source and written into the new `openclaw.json`

### What is re-provisioned

- `openclaw.json` — written fresh for the target mode with the correct workspace path and preserved token. Any existing config at the target config path is deleted before provisioning so the provisioning step does not skip it.

---

### Docker → Profile

1. **Stop** Docker container via `dockerBackend.stop(id)` (if running)
2. **Read token** from `fleetDir/.env` via `dockerBackend.revealToken(id)`
3. **Resolve paths:**
   - `existingWorkspaceDir` = `fleetConfig.getDockerWorkspaceDir(id)` (host path)
   - `existingConfigDir` = `fleetConfig.getDockerConfigDir(id)`
4. **Delete** `${existingConfigDir}/openclaw.json` so profile provisioning writes a fresh config with the host workspace path
5. **Register and start** via `profileBackend.createInstanceFromMigration({ name: id, workspaceDir: existingWorkspaceDir, configDir: existingConfigDir, token, port? })`
   - Writes profile-mode `openclaw.json`: `gateway.auth.token = token`, `agents.defaults.workspace = existingWorkspaceDir` (host path, not container-internal)
   - Registers entry in `profiles.json`
   - Starts the native process
6. **If `deleteSource`:** `dockerBackend.removeInstance(id)` (stops container + cleans Tailscale + removes token from `.env`)

---

### Profile → Docker

1. **Stop** profile process via `profileBackend.stop(id)` — uses the `stopping` set internally, which suppresses the auto-restart `exit` handler so the process does not revive mid-migration
2. **Read token** from profile's `openclaw.json` via `profileBackend.revealToken(id)`
3. **Resolve paths:**
   - `existingWorkspaceDir` = `${profileEntry.stateDir}/workspace`
4. **Delete** the Docker configDir's `openclaw.json` (if it exists at `fleetConfig.getDockerConfigDir(id)/openclaw.json`) so Docker provisioning writes a fresh config with the container-internal workspace path
5. **Create container** via `dockerBackend.createInstanceFromMigration({ name: id, workspaceDir: existingWorkspaceDir, token })`
   - Assigns next available index
   - Writes Docker-mode `openclaw.json`: `gateway.auth.token = token`, `agents.defaults.workspace = '/home/node/.openclaw/workspace'` (container-internal path)
   - Bind-mounts `existingWorkspaceDir` → `/home/node/.openclaw/workspace` inside the container
   - Starts the container
6. **If `deleteSource`:** `profileBackend.removeInstance(id)` (stops process if somehow still running + removes from registry)

---

### Internal helpers

Both `createInstanceFromMigration` methods are **not** added to the `DeploymentBackend` interface — they are concrete methods on `DockerBackend` and `ProfileBackend` respectively, called only from `HybridBackend.migrate()`.

**`ProfileBackend.createInstanceFromMigration(opts)`** — skips `openclaw --profile setup`; writes openclaw.json directly; registers profile entry; starts process.

**`DockerBackend.createInstanceFromMigration(opts)`** — like `createInstance` but accepts an explicit `token` and `workspaceDir`; assigns next available index; provisions and starts container.

---

## Section 3: UI

### Placement

A "Migrate" button is added to the instance `OverviewTab`, visible only when `currentUser.role === 'admin'`. Placed near the existing start/stop/restart action row.

### MigrateDialog

New component: `packages/web/src/components/instances/MigrateDialog.tsx`

Contents:
- **Target mode** — radio buttons: "Docker" / "Profile" (current mode pre-selected and disabled so user must pick the other)
- **Delete source** — checkbox: "Remove source instance after migration" (unchecked by default)
- **Migrate** / **Cancel** buttons

Behaviour:
- While migrating: button shows loading state
- On success: dialog closes, React Query invalidates the fleet query, store selects the (same-named) new instance
- On error: inline error message within the dialog (e.g. "Migration failed: server is not in hybrid mode")

### API client

New file: `packages/web/src/api/migrate.ts`

```ts
export const migrateInstance = (id: string, body: { targetMode: 'docker' | 'profile'; deleteSource?: boolean }) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/migrate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
```

---

## Out of scope

- Migration between two Docker instances or two profiles (not meaningful)
- Progress streaming for migration (workspace is reused in-place so migration is fast)
- Rollback on partial failure — source is only removed if `deleteSource=true` and migration succeeds; on failure, source remains stopped and can be manually restarted
- Non-hybrid deployments — API enforces this; UI shows button regardless but surfaces API error
