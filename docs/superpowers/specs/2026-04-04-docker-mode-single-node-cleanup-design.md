# Docker Mode Single-Node Cleanup & Enhancement

**Date:** 2026-04-04
**Branch:** dockermodeenhance

## Context

The fleet manager is a single-node tool. A previous PR removed docker-compose-based orchestration. This spec cleans up the remaining compose-era remnants and makes Docker mode more coherent for single-node use.

---

## Section 1: Removals

### 1a. `scaleFleet` purge

`scaleFleet(count, fleetDir)` was a compose-era batch operation that created/removed containers to reach a target count. It is no longer needed — instances are managed individually via `createInstance` / `removeInstance`.

**Changes:**
- Remove `scaleFleet(count: number, fleetDir: string): Promise<FleetStatus>` from `DeploymentBackend` interface (`backend.ts`)
- Remove implementation from `DockerBackend` (`docker-backend.ts` lines 296–320)
- Remove implementation from `ProfileBackend` (`profile-backend.ts`)
- Remove implementation from `HybridBackend` (`hybrid-backend.ts` lines 86–89)
- Remove `POST /api/fleet/scale` route, `scaleSchema`, and the `scaling` module-level flag from `fleet.ts`
- Remove related tests: 3 cases in `fleet.test.ts`, 1 case (`scaleFleet() removes...`) in `docker-backend.test.ts`

### 1b. `MonitorService` deletion

`MonitorService` (`monitor.ts`) is dead code — it is never imported from `index.ts` and its responsibilities are fully handled by `DockerBackend.refresh()` and the 5s polling interval.

**Changes:**
- Delete `packages/server/src/services/monitor.ts`
- Delete `packages/server/tests/services/monitor.test.ts`

### 1c. Docker volume disk usage cleanup

`DockerService.getDiskUsage()` queries `docker df` for named Docker volumes. Fleet containers use bind mounts — not named volumes — so this call always returns nothing useful. The override block in `DockerBackend.refresh()` (lines 104–121) is a no-op.

**Changes:**
- Remove `getDiskUsage()` from `DockerService` (`docker.ts`)
- Remove the override block in `DockerBackend.refresh()` (the `try { const diskUsage = ... }` block)
- Disk sizes will come exclusively from `getDirectorySize()` filesystem traversal, which already works correctly

---

## Section 2: `FleetConfig.count` → read-only live total

`FleetConfig.count` was originally a desired-count from `COUNT` in `fleet.env` (compose-era). It is now repurposed as a read-only snapshot of the total live instance count (Docker + profile combined).

**Changes:**
- Remove `countOverride?: number` parameter from `FleetConfigService.readFleetConfig()`
- Remove `COUNT` from `fleet.env` parsing in `readFleetConfig()`
- Remove `count` from `FleetConfig` type as a stored/configurable field
- In `config.ts` GET `/api/config/fleet`: compute count as `backend.getCachedStatus()?.instances.length ?? 0` and inject it into the response
- `FleetConfig` type keeps `count: number` as a read-only response field
- `schemas.ts` keeps `count` in the response schema as a read-only integer

**Invariant:** `count` is never written by clients; it is always computed server-side at request time.

---

## Section 3: Tailscale warning on `createInstance`

When Tailscale setup fails during `createInstance`, the instance is still created successfully. Currently the error is only logged. The response should carry a warning so callers and the UI can surface it.

**Changes:**
- Add `tailscaleWarning?: string` to `FleetInstance` type (`types.ts`) and schema (`schemas.ts`)
- In `DockerBackend.createInstance()`: catch error from `tailscale.setup()`, set `tailscaleWarning` on the returned instance (e.g. `"Tailscale setup failed: ${err.message}"`)
- In `DockerBackend.refresh()`: the cached instance will not carry `tailscaleWarning` (it is transient, only on the create response)
- Web UI `OverviewTab`: display `tailscaleWarning` as amber text below the Tailscale URL row if present

---

## Auto-restart policy

Docker containers already use `RestartPolicy: { Name: 'unless-stopped' }` — no change needed. Containers restart on crash; explicit stop via fleet manager is respected.

---

## Out of scope

- No changes to profile backend beyond removing `scaleFleet`
- No changes to Tailscale teardown error handling
- No changes to `FleetConfigPanel` UI (already shows only BASE_DIR and TZ)
- No new Docker features (image pull, exec improvements)
