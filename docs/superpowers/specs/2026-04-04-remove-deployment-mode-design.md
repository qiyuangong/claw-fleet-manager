# Remove Deployment Mode Design

**Date:** 2026-04-04
**Branch:** dockermodeenhance

## Overview

The server always runs in hybrid mode (`HybridBackend` is unconditionally instantiated in `index.ts`). The `deploymentMode` configuration field and the `FleetStatus.mode` field are dead — they carry no branching logic and always resolve to `'hybrid'`. This spec removes both to simplify the codebase.

---

## Section 1: Remove `deploymentMode` config field

### What is removed

- `deploymentMode: z.enum(['docker', 'profiles', 'hybrid']).default('hybrid')` from the zod schema in `config.ts`
- `deploymentMode?: 'docker' | 'profiles' | 'hybrid'` from the `ServerConfig` interface in `types.ts`
- `deploymentMode: 'docker' | 'profiles' | 'hybrid'` from the `FastifyInstance` declaration in `fastify.d.ts`
- `app.decorate('deploymentMode', 'hybrid')` from `index.ts`

### Affected tests

Remove `app.decorate('deploymentMode', ...)` from test setup in:
- `tests/routes/instances.test.ts`
- `tests/routes/documentation.test.ts`
- `tests/routes/plugins.test.ts`
- `tests/routes/profiles.test.ts`
- `tests/routes/fleet.test.ts` (two `beforeEach` blocks)
- `tests/routes/logs.test.ts`
- `tests/routes/config.test.ts`

---

## Section 2: Remove `FleetStatus.mode` field

### What is removed

- `mode: 'docker' | 'profiles' | 'hybrid'` from the `FleetStatus` interface in `packages/server/src/types.ts`
- `mode: { type: 'string', enum: ['docker', 'profiles', 'hybrid'] }` from `fleetStatusSchema` in `packages/server/src/schemas.ts` (removed from both properties and required array)
- `mode: 'docker'` from the two `FleetStatus` literal objects constructed in `packages/server/src/services/docker-backend.ts` (lines 85 and 124)
- `mode: 'hybrid'` from the `FleetStatus` object returned by `mergeStatuses()` in `packages/server/src/services/hybrid-backend.ts` (line 133)
- `mode: 'profiles'` from the `FleetStatus` literal object constructed in `packages/server/src/services/profile-backend.ts` (line 142)
- `{ mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() }` fallback in `packages/server/src/routes/fleet.ts` line 36 — replace with `{ instances: [], totalRunning: 0, updatedAt: Date.now() }`

### Affected tests

Remove `status.mode` assertions from:
- `tests/services/hybrid-backend.test.ts` — two `expect(status.mode).toBe('hybrid')` assertions
- `tests/services/docker-backend.test.ts` — `expect(status.mode).toBe('docker')` and `expect(backend.getCachedStatus()?.mode).toBe('docker')`
- `tests/services/profile-backend.test.ts` — `expect(status?.mode).toBe('profiles')`
- `tests/routes/fleet.test.ts` — `expect(res.json().mode).toBe('hybrid')`

---

## Section 3: Web changes

- Remove `mode: 'docker' | 'profiles' | 'hybrid'` from the `FleetStatus` interface in `packages/web/src/types.ts`

No UI component reads `fleet.mode`. Individual `instance.mode: 'docker' | 'profile'` on `FleetInstance` is a separate field and is unchanged.

---

## Out of scope

- `InstanceMode` (`'docker' | 'profile'`) on `FleetInstance` — unchanged
- `DockerBackend`, `ProfileBackend`, `HybridBackend` class structure — unchanged
- `profiles.ts` route's internal `mode: 'profiles'` literal — unrelated to `FleetStatus`
- `openclaw.json` gateway config fields (`mode`, `auth.mode`) — unrelated
