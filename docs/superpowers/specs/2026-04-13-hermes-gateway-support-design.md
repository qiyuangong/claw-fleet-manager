# Hermes Gateway Support Design

## Goal

Add first-class `hermes-agent` gateway support to Claw Fleet Manager so Hermes instances can be created, managed, and observed in the same fleet list as existing OpenClaw instances.

The first implementation target is Hermes gateway management only. It must support both native/profile deployments and Docker deployments, while avoiding OpenClaw-specific assumptions such as `openclaw.json`, OpenClaw gateway RPC, and OpenClaw control UI proxy behavior.

## Scope

In scope:

- represent Hermes instances in the shared fleet list
- support `profile` and `docker` deployment modes for Hermes
- create, remove, rename, start, stop, and restart Hermes gateway instances
- stream Hermes logs
- expose Hermes-managed config files for read/write editing
- show runtime-aware instance metadata in the UI
- keep current OpenClaw behavior unchanged

Out of scope for this phase:

- OpenClaw-to-Hermes migration
- Hermes-to-OpenClaw migration
- reuse of OpenClaw session RPC, Control UI proxy, Feishu flows, or plugin flows for Hermes
- full Hermes feature parity beyond gateway lifecycle, logs, config editing, and runtime-aware access surfaces

## Product Shape

The fleet model must separate runtime family from deployment mode.

- `runtime`: `openclaw | hermes`
- `mode`: `docker | profile`

Supported combinations after this change:

- OpenClaw profile
- OpenClaw docker
- Hermes profile
- Hermes docker

This keeps one fleet list in the UI while preserving the current operator mental model that instances can be native/profile-backed or Docker-backed.

## Why This Shape

The current codebase treats OpenClaw-specific concepts as part of instance management:

- OpenClaw profile creation shells out to `openclaw --profile <name>`
- OpenClaw Docker provisioning writes `openclaw.json`
- OpenClaw proxy and sessions depend on OpenClaw gateway protocols
- instance naming and validation contain OpenClaw-specific rules

Modeling Hermes as just another OpenClaw instance would spread runtime conditionals across the existing code and couple Hermes to behavior it does not implement. Modeling Hermes as a third flat instance type would collapse two different dimensions into one field and break down as soon as Hermes needs both native and Docker support.

Separating runtime from mode keeps the architecture extensible and lets Hermes land without rewriting the current fleet UX.

## Architecture

### Shared Fleet Instance Model

Extend the server and web instance types with runtime-aware metadata.

Required fields:

- `runtime: 'openclaw' | 'hermes'`
- `mode: 'docker' | 'profile'`

Existing shared fields remain:

- `id`
- `status`
- `port` or equivalent externally reachable gateway/API port when present
- `uptime`
- `cpu`
- `memory`
- `disk`
- `health`
- `image`

Optional runtime-specific metadata:

- `profile`
- `pid`
- `runtimeCapabilities`

`runtimeCapabilities` should be introduced as a capability map so the UI can hide unsupported tabs and actions without hard-coding all behavior around `runtime`.

Initial capability flags:

- `configEditor`
- `logs`
- `rename`
- `delete`
- `proxyAccess`
- `sessions`
- `plugins`
- `runtimeAdmin`

### Backend Layout

Replace the current implicit OpenClaw-only backend composition with runtime-specific backends behind one router.

Target structure:

- `OpenClawDockerBackend`
- `OpenClawProfileBackend`
- `HermesDockerBackend`
- `HermesProfileBackend`
- `FleetBackendRouter`

`FleetBackendRouter` owns:

- merged fleet refresh
- routing start/stop/restart/remove/rename by `(runtime, mode, id)`
- create-instance dispatch based on requested runtime and mode
- shared validation for id collisions across all backends

The existing `HybridBackend` can either be evolved into this router or replaced by a new router class. The important constraint is that routing must no longer assume there are only two OpenClaw-oriented backends.

### Hermes Profile Backend

Hermes profile instances map to real Hermes profiles and profile-scoped `HERMES_HOME` directories.

Each Hermes profile instance must:

- create or adopt a dedicated profile under a configured Hermes profiles root
- run a Hermes gateway process scoped to that profile
- use Hermes runtime files for PID, gateway state, logs, config, workspace, and other persistent state
- expose status from Hermes-owned runtime files and process checks rather than OpenClaw gateway RPC

Process model:

- launch Hermes with profile-scoped environment or `-p <name>` arguments
- manage lifecycle around the long-lived `hermes gateway` process
- stop/restart using Hermes-compatible process handling instead of OpenClaw conventions

Config model:

- edit Hermes config files owned by that profile
- do not write or expect `openclaw.json`

### Hermes Docker Backend

Hermes Docker instances run Hermes gateway inside containers with persistent mounted instance data.

Each Hermes Docker instance must:

- create a per-instance persistent data directory
- mount that directory into the container as `HERMES_HOME` or equivalent runtime data root
- start `hermes gateway` as the container command
- persist logs and config within the mounted data root where practical
- expose container lifecycle and metrics through the Docker backend path

The Docker implementation must not reuse OpenClaw-specific provisioning steps such as generating `openclaw.json` or assuming OpenClaw workspace layout.

### Access Surface

Hermes does not expose the same local control protocol as OpenClaw. The manager must not pretend Hermes supports OpenClaw control tabs.

For Hermes instances in this phase:

- supported: lifecycle, overview, logs, config editing, runtime-aware access details
- not supported: OpenClaw Control UI proxy, OpenClaw sessions RPC, OpenClaw plugin flows, OpenClaw pairing flows

If Hermes exposes a usable API endpoint for a given deployment, the UI may show that endpoint as runtime-specific access info. This should be additive and capability-gated, not shoehorned into the OpenClaw proxy codepath.

## API Changes

### Create Instance

Extend instance creation requests with runtime family.

Current logical shape:

- `kind: 'docker' | 'profile'`

Target shape:

- `runtime: 'openclaw' | 'hermes'`
- `kind: 'docker' | 'profile'`

The server must reject unsupported combinations and validate names consistently across the unified fleet.

### Fleet Status

Fleet responses must include the new runtime metadata and capability flags for every instance so the web app can render a mixed-runtime fleet without guesswork.

### Config Read/Write

The config routes remain shared, but backend implementations become runtime-aware:

- OpenClaw backends keep current behavior
- Hermes backends read/write Hermes-managed config files

## Configuration Changes

Server configuration needs a Hermes section parallel to current OpenClaw-related defaults.

Proposed server config additions:

- `hermes.profiles.binary`
- `hermes.profiles.baseHomeDir`
- `hermes.profiles.stopTimeoutMs`
- `hermes.docker.image`
- `hermes.docker.env`
- `hermes.docker.mountPath`

These settings must be optional with stable defaults so OpenClaw-only deployments continue to work without change.

## UI Changes

### Fleet List

The shared fleet table remains the primary surface.

Required updates:

- show `runtime` and `mode`
- allow filtering and labels for Hermes vs OpenClaw
- distinguish Hermes Docker and Hermes profile instances clearly

### Add Instance Flow

The create-instance UI must collect:

- runtime family
- deployment mode
- name
- mode-specific advanced settings

For Hermes:

- profile creation uses Hermes profile defaults
- Docker creation uses Hermes image and environment defaults

### Instance Detail Tabs

Tabs must be capability-driven.

For Hermes in phase one:

- keep Overview
- keep Logs
- keep Config when backend supports Hermes config editing
- hide OpenClaw-only tabs and actions

The UI must not render broken tabs for Hermes just because they exist for OpenClaw.

## Error Handling

The system must return explicit runtime-aware errors for:

- unsupported runtime/mode combinations
- missing Hermes binary in profile mode
- missing Hermes Docker image or Docker daemon access in Docker mode
- conflicts with existing instance ids across all runtimes
- attempts to access unsupported runtime capabilities

User-facing errors should state whether the failure came from Hermes profile management, Hermes Docker management, or shared fleet routing.

## Testing

### Server Tests

Add and update tests for:

- create-instance validation with `runtime + kind`
- mixed-runtime fleet status merging
- routing lifecycle actions to the correct backend
- Hermes capability flags
- Hermes config read/write dispatch
- Hermes-specific name collision and unsupported capability errors

### Web Tests

Add and update tests for:

- create-instance dialog runtime selection
- mixed-runtime fleet rendering
- capability-based tab visibility
- runtime-aware labels and action gating

### Integration Expectations

The implementation should be verified against a real local Hermes install and, if available, a local Hermes Docker image. Mock-only verification is insufficient because the core risk is mismatched process/config assumptions.

## Incremental Delivery Plan

Phase 1 must be small enough to ship without destabilizing OpenClaw support.

Recommended delivery order:

1. add runtime metadata to shared types and fleet responses
2. refactor backend routing to support `(runtime, mode)`
3. land Hermes profile backend
4. land Hermes Docker backend
5. update create-instance API and UI
6. gate tabs/actions by capability
7. add tests and operator docs

## Open Questions Resolved

- Hermes support is gateway-first, not full feature parity with all Hermes subsystems.
- Hermes must support both Docker and profile deployment shapes in the first phase.
- Hermes instances live in the same fleet list as OpenClaw instances.
- Hermes should be modeled like OpenClaw in terms of `docker/profile` deployment modes, but as a separate runtime family.

## Success Criteria

This design is successful when:

- admins can create and manage Hermes profile and Hermes Docker instances from the existing fleet UI
- Hermes and OpenClaw instances coexist in one fleet view without ambiguous labels
- Hermes lifecycle, logs, and config editing work without relying on OpenClaw-specific files or protocols
- OpenClaw behavior remains unchanged for current users
