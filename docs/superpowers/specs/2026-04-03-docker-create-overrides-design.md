# Docker Create Overrides Design

## Summary

Move Docker-specific creation settings out of the Fleet Config page and into the `Create Docker Instance` dialog. These values are per-instance overrides only and must not mutate global fleet config defaults.

## Problem

The current Fleet Config page mixes shared control-plane settings with Docker-only runtime settings:

- `Docker Image`
- `CPU Limit`
- `Memory Limit`
- `Port Step`
- `Enable npm packages`

That makes the page misleading in a merged profile/docker product because those fields do not apply to profile instances and should be chosen at Docker instance creation time instead.

## Decision

Use an advanced section in the `Create Docker Instance` dialog:

- Keep the default flow simple: instance name first
- Add a collapsed or clearly separated `Advanced Docker Config` block
- Put Docker-only fields in that block
- Apply those values only to the Docker instance being created
- Do not update global fleet config when these values are used

## UI Changes

### Fleet Config

Keep only shared/global settings that affect existing managed instances:

- `Base Directory`
- `Timezone`
- any truly shared infrastructure/control-plane values already on that page

Remove from Fleet Config:

- `API Key`
- `Config Base`
- `Workspace Base`
- `Docker Image`
- `CPU Limit`
- `Memory Limit`
- `Port Step`
- `Enable npm packages`

### Create Docker Instance Dialog

Keep the current name field and add an advanced Docker block containing:

- `API Key`
- `Docker Image`
- `CPU Limit`
- `Memory Limit`
- `Port Step`
- `Enable npm packages`

Expected behavior:

- User can create a Docker instance by name without opening advanced settings
- If advanced settings are used, they apply only to that created Docker instance
- Profile creation dialog remains unchanged

## API Changes

Extend Docker instance creation payloads to accept optional per-instance Docker overrides:

- `apiKey`
- `openclawImage`
- `cpuLimit`
- `memLimit`
- `portStep`
- `enableNpmPackages`

These fields are valid only when `kind: 'docker'`.

Profile create requests continue using:

- `name`
- optional `port`
- optional config payload

## Backend Behavior

When creating a Docker instance:

- Start from current global defaults
- Overlay request-level Docker overrides if provided
- Provision config/workspace/container using the merged result
- Do not persist those overrides back into Fleet Config

This makes the create request self-contained and avoids unintended changes to future Docker instances.

Fleet Config should not expose values that only matter to future instance creation. In particular, the existing `API Key` field should be removed because it does not affect already-created instances.

Fleet Config should also stop exposing separate `Config Base` and `Workspace Base` fields. Storage layout is now derived from one shared `baseDir`, so showing those derived paths only adds confusion.

`baseDir` itself should remain editable in Fleet Config. It is the single fleet-level storage root and should be configurable when setting up a new fleet or changing the intended root for future managed instances.

## Validation

### Web

- Fleet Config no longer renders Docker-only fields or `API Key`
- Fleet Config no longer renders `Config Base` or `Workspace Base`
- Fleet Config keeps an editable `Base Directory` field
- Create Docker dialog shows advanced Docker config
- Create Profile dialog does not show Docker-only fields

### Storage Model

Expose only one storage root:

- `baseDir`

This field is editable in Fleet Config for new fleet setup and future fleet-level changes.

Derived paths are implicit:

- Docker config: `<baseDir>/<instance>/config`
- Docker workspace: `<baseDir>/<instance>/workspace`
- Profile config: `<baseDir>/<profile>/openclaw.json`
- Profile workspace: `<baseDir>/<profile>/workspace`

### Server

- Docker create route accepts Docker override fields
- Docker backend uses request overrides for the created instance only
- Fleet config write path remains unchanged

## Risks

- `portStep` is currently also used in parts of Docker fleet-wide indexing/port math, so making it per-instance may require careful handling or a narrower interpretation during creation
- If Docker defaults are still assumed globally in some backend code, those assumptions must be isolated before request-local overrides are safe

## Non-Goals

- No redesign of Profile creation
- No migration of existing Docker instances
- No change to shared `baseDir` behavior introduced separately
