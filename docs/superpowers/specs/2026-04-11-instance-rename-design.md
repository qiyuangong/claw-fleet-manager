# Instance Rename Design

**Date:** 2026-04-11
**Branch:** feat/rename-instance

## Overview

Add an admin-only rename feature for both profile and Docker instances. Rename is an in-place identity change, not a display alias and not a recreate/copy flow. The renamed instance keeps its existing runtime assets and ownership: config, workspace, token, index/port semantics, and user assignment references.

Rename requires the source instance to be stopped before any persistent changes are made. The API rejects rename attempts for running instances instead of auto-stopping or attempting a live rename.

---

## Section 1: API

### Endpoint

```http
POST /api/fleet/instances/:id/rename
```

**Auth:** `requireAdmin`

**Body:**

```json
{
  "name": "team-beta"
}
```

- `name` — required target id for the renamed instance

**Response (200):** The renamed `FleetInstance`

**Validation rules:**

- Source `:id` must match existing managed instance id validation
- Target `name` must be unique across the full fleet, not just within one backend
- Target `name` must follow the existing managed naming rules
- Profile renames reuse `isValidManagedProfileName()` so reserved names like `main` remain invalid
- Docker renames reuse `MANAGED_INSTANCE_ID_RE`

**Error responses:**

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_ID` | 400 | Source id is malformed |
| `INVALID_NAME` | 400 | Target name is malformed or reserved |
| `INSTANCE_NOT_FOUND` | 404 | Source instance does not exist |
| `RENAME_CONFLICT` | 409 | Target name already exists anywhere in the fleet |
| `RENAME_REQUIRES_STOP` | 409 | Source instance is still running |
| `RENAME_FAILED` | 500 | Rename failed after validation |

### Route placement

Add the route to `packages/server/src/routes/fleet.ts` so instance management continues to live under the shared fleet management surface already used by the web UI.

### API client

Add a web API helper to `packages/web/src/api/fleet.ts`:

```ts
export const renameInstance = (id: string, name: string) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
```

---

## Section 2: Coordination Logic

### Ownership

Rename is exposed as `renameInstance(id, nextName)` on `DeploymentBackend` and coordinated by `HybridBackend`.

`HybridBackend` should receive `UserService` as a constructor dependency so rename can update assignments in the same orchestration path that already resolves backend ownership.

`HybridBackend.renameInstance()` is responsible for:

1. Resolving which backend owns `id`
2. Validating that `nextName` is globally available across Docker and profile instances
3. Delegating the actual rename to the owning backend
4. Updating user assignments from `id` to `nextName`
5. Refreshing the merged fleet status and returning the renamed instance

This keeps the product behavior uniform while letting each backend own its storage/runtime specifics.

### User assignment migration

`UserService` gains a targeted helper that rewrites assigned profile ids from `oldId` to `newId` for every user.

Expected behavior:

- Preserve current ownership relationships
- Replace exact matches only
- Keep unrelated profile assignments unchanged
- Persist atomically with the existing `.tmp` + rename write pattern

This is required because the current authorization and user-management flows treat instance ids as durable assignment keys.

### Operation ordering

Rename follows this order:

1. Validate source id and target name
2. Confirm source exists
3. Confirm target name is unused across both backends
4. Confirm source instance is stopped
5. Perform backend-specific rename
6. Rewrite user assignments
7. Refresh fleet state
8. Return renamed instance

### Atomicity stance

We want rename to behave atomically from the API consumer's perspective, but full rollback across Docker state, profile state, filesystem moves, and `users.json` is not worth the complexity for this change.

The implementation should instead:

- Use atomic file writes where already available
- Order steps so no mutation happens before all validations pass
- Log any post-rename assignment rewrite failure loudly with source and target ids
- Return an error if assignment rewrite fails, even if backend rename already completed

This means the only realistic partial-failure window is "instance renamed, assignments not yet rewritten". The implementation should keep that window narrow and covered by tests.

---

## Section 3: Profile Backend Rename

### Preconditions

- Source profile exists in the registry
- Source profile is stopped (`pid === null` and current status is not `running`)
- Target name passes profile naming validation and does not already exist

### Rename steps

1. Load the existing profile entry from `registry.profiles[id]`
2. Resolve the renamed paths:
   - `nextStateDir`
   - `nextConfigDir`
   - `nextConfigPath`
3. Rename the state/config directories on disk
4. Rewrite `openclaw.json` so `agents.defaults.workspace` points to `nextStateDir/workspace`
5. Move the registry entry from `id` to `nextName`
6. Update entry fields:
   - `name`
   - `stateDir`
   - `configPath`
7. Persist the registry
8. Refresh cached fleet state

### Preserved values

- Existing gateway token
- Port
- Workspace contents
- Config contents aside from rewritten workspace path
- Historical state tied to the existing profile directory

### Notes

- Since rename requires stop-first, no running process needs to be adopted or retargeted mid-operation
- The profile auto-restart path is not involved because the instance is already stopped

---

## Section 4: Docker Backend Rename

### Preconditions

- Source container exists
- Source container is stopped
- Target name passes managed instance id validation and does not already exist

### Rename steps

1. Resolve the existing container and its index
2. Resolve renamed managed directories:
   - `getDockerInstanceRoot(oldId)` -> `getDockerInstanceRoot(newId)`
   - config dir
   - workspace dir
3. Rename the managed instance root on disk so config, workspace, and metadata move together
4. Rename the Docker container to `nextName`
5. Refresh cached fleet state

### Preserved values

- Container index
- Gateway token in `.env`
- Port and Tailscale mapping derived from index
- Per-instance metadata such as `claw-fleet-meta.json`
- Workspace and config contents

### Notes

- No token migration is needed because tokens are index-based, not name-based
- No Tailscale remap is needed because Tailscale setup is also index-based
- Renaming the root directory instead of individual subdirectories keeps meta/config/workspace aligned and reduces failure points

---

## Section 5: UI

### Placement

Add a `Rename` action to `InstanceManagementPanel` for every instance row, alongside `Open` and `Delete`.

This panel is already the admin-only surface for create/delete operations and is the natural home for rename.

### Rename dialog

Add a small dialog with:

- current instance id
- target name input
- inline validation/error area
- `Rename` and `Cancel` buttons

Behavior:

- Submits the shared rename API regardless of mode
- Invalidates both `fleet` and `users` queries on success
- Clears dialog state on success
- Surfaces backend errors inline

### Selection behavior

If the currently selected instance in the store is renamed, the UI should update selection to the new id so the admin stays on the renamed instance instead of landing on a stale selection.

---

## Section 6: Testing

### Server route tests

Add coverage for:

- successful rename request
- invalid target name
- conflict when target already exists
- stopped-only enforcement
- not found source behavior

### Hybrid backend tests

Add coverage for:

- choosing the correct backend by source id
- rejecting cross-backend target collisions
- invoking assignment rewrite after backend rename
- returning the refreshed renamed instance

### Profile backend tests

Add coverage for:

- rejecting rename for running profiles
- renaming registry entry keys and stored paths
- rewriting workspace path in `openclaw.json`
- preserving port/token/config contents

### Docker backend tests

Add coverage for:

- rejecting rename for running containers
- renaming the managed instance root directory
- renaming the Docker container
- preserving index-derived port behavior and token lookup

### User service tests

Add coverage for:

- replacing assigned profile ids for one or multiple users
- leaving unrelated assignments untouched
- persisting atomically

### Web tests

Add coverage for:

- opening rename dialog from `InstanceManagementPanel`
- submitting a new name
- invalidating fleet/users queries after success
- keeping instance selection aligned with the renamed id
- showing inline error text on failure

---

## Out of scope

- Live rename of running instances
- Rename aliases or separate display names
- Batch rename
- Cross-backend rollback orchestration after partial failure
- Renaming non-managed standalone profile names such as `main`
