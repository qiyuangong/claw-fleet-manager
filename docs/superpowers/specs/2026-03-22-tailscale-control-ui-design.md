# Tailscale Serve Integration for Control UI Remote Access

**Date:** 2026-03-22
**Status:** Approved

## Problem

The Control UI currently opens via a direct URL (`http://{host}:{port}/#token={token}`), which only works on localhost. Remote browsers cannot reach openclaw instance ports directly. Even if ports were opened, openclaw rejects non-HTTPS remote connections (WebCrypto requires a secure context), and Docker bridge networking means connections from the fleet manager proxy arrive at the container as `172.x.x.x` — treated as remote by openclaw's auth policy.

## Solution

Use Tailscale Serve on the host to expose each openclaw instance with HTTPS on the tailnet. Configure openclaw with `gateway.auth.allowTailscale: true` so it authenticates connections via Tailscale identity headers rather than source IP. The fleet manager manages the `tailscale serve` lifecycle per instance.

## Prerequisites

- Tailscale must be installed and authenticated on the host machine (`tailscale version` succeeds)
- The host machine must be connected to a tailnet
- The `tailscale` binary must be on the PATH of the fleet manager process

## Architecture

```
Browser (tailnet)
    │ https://{hostname}:{tsPort}/
    ▼
Tailscale daemon (host) ── adds Tailscale identity headers ──►
    │ http://localhost:{gwPort}/
    ▼
Docker port mapping
    │
    ▼
openclaw container :18789
    └─ gateway.auth.allowTailscale: true  → trusts identity headers
    └─ allowedOrigins: ["https://{hostname}:{tsPort}"]
```

The feature is opt-in: when `tailscale.hostname` is absent from `server.config.json`, all Tailscale behaviour is disabled and the existing direct-URL fallback is used.

## Components

### 1. `ServerConfig` (`packages/server/src/config.ts` + `types.ts`)

Add optional `tailscale` block:

```typescript
export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  tailscale?: { hostname: string };  // e.g. "machine.tailnet.ts.net"
}
```

Zod schema: `tailscale: z.object({ hostname: z.string() }).optional()`.

`server.config.example.json` gains a commented-out `tailscale` block.

### 2. `FleetInstance` (`packages/server/src/types.ts`)

```typescript
export interface FleetInstance {
  id: string;
  index: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;  // e.g. "https://machine.tailnet.ts.net:8800"
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
}
```

### 3. `TailscaleService` (new: `packages/server/src/services/tailscale.ts`)

Manages `tailscale serve` configs per instance.

**Port allocation:** `BASE_TS_PORT (8800) + (index - 1)` — fixed step of 1, independent of gateway `portStep`. Produces 8800, 8801, 8802, etc.

**Persistence:** `{fleetDir}/tailscale-ports.json` stores `{ "1": 8800, "2": 8801, ... }` (string keys, number values — consistent with JSON serialisation). Used to rebuild in-memory URL map on fleet manager restart without re-running serve commands (Tailscale persists serve configs in its own state).

```typescript
class TailscaleService {
  // Runs: tailscale serve --bg --https={tsPort} localhost:{gwPort}
  // Then verifies via: tailscale serve status --json
  //   Success condition: the JSON contains a handler for https:{tsPort} with backend localhost:{gwPort}
  //   On verification failure: run teardown, throw Error — caller logs and continues
  // Returns the HTTPS URL: https://{hostname}:{tsPort}
  async setup(index: number, gwPort: number): Promise<string>

  // Runs: tailscale serve --https={tsPort} off   (no --bg flag)
  // Errors are logged and non-fatal — teardown failure must not block scale-down
  async teardown(index: number): Promise<void>

  // Returns stored URL for an index (undefined if not configured)
  getUrl(index: number): string | undefined

  // On fleet manager startup: reads tailscale-ports.json, rebuilds in-memory URL map.
  // For each entry, verifies the serve rule is active via `tailscale serve status --json`.
  // If a rule is missing (e.g. Tailscale state was reset), re-runs setup() to restore it.
  // Instances that no longer exist in the fleet are removed from the port file.
  async syncAll(instances: { index: number; gwPort: number }[]): Promise<void>
}
```

**Startup preflight (in `index.ts`):** Before instantiating `TailscaleService`, run `tailscale version`. If it fails, abort startup with a clear error message: `"tailscale.hostname is configured but the tailscale CLI is not available. Install and authenticate Tailscale before starting the fleet manager."`.

### 4. `ComposeGenerator` (`packages/server/src/services/compose-generator.ts`)

Signature change:

```typescript
generate(count: number, tailscaleConfig?: { hostname: string; portMap: Map<number, number> }): void
```

`portMap` maps instance index → Tailscale port (provided by `TailscaleService` after ports are allocated). When `tailscaleConfig` is provided, writes `{configDir}/openclaw.json` for each **new** instance (determined by whether the file already exists in the directory — `existsSync(join(configDir, 'openclaw.json'))`). Skips existing files to avoid overwriting user customisation.

Config written per instance:

```json
{
  "gateway": {
    "auth": {
      "allowTailscale": true
    },
    "controlUi": {
      "allowInsecureAuth": true
    }
  },
  "allowedOrigins": ["https://{hostname}:{tsPort}"]
}
```

`{tsPort}` is the per-instance port from `portMap`. The `allowedOrigins` entry includes the port because browser `Origin` headers are port-sensitive — `https://hostname` does not match `https://hostname:8800`.

No changes to the Docker Compose service definition or startup command.

### 5. `MonitorService` (`packages/server/src/services/monitor.ts`)

Receives a `TailscaleService | null` reference. When building `FleetInstance` objects, populates `tailscaleUrl` from `tailscaleService?.getUrl(index)`.

### 6. Fleet scale route (`packages/server/src/routes/fleet.ts`)

**Scale-up ordering:**

1. Allocate Tailscale ports for new instances (via `TailscaleService.allocatePorts(newIndices)` — stores to port file, does not run serve yet)
2. Call `composeGenerator.generate(count, tailscaleConfig)` — writes `openclaw.json` with correct per-instance ports
3. Run `docker compose up -d`
4. For each new index: call `tailscaleService.setup(index, gwPort)` — errors are caught, logged, and non-fatal (the instance still runs, just without Tailscale access)

Note: `tailscale serve` is activated after container start but before the healthcheck `start_period` (20s) completes. Clients may receive connection errors for up to 30s after scale-up. This is acceptable and intentional — no readiness gate is added.

**Scale-down ordering:**

1. For each removed index: call `tailscaleService.teardown(index)` — errors logged, non-fatal
2. Call `composeGenerator.generate(count, tailscaleConfig)`
3. Run `docker compose up -d` (removes stopped containers)

### 7. `index.ts`

```
1. loadConfig()
2. If config.tailscale: run tailscale version preflight, abort on failure
3. Instantiate TailscaleService (or null)
4. Instantiate other services
5. If TailscaleService: call syncAll(existingInstances)
6. Pass TailscaleService to MonitorService and fleet route
7. Start server
```

### 8. `ControlUiTab` (`packages/web/src/components/instances/ControlUiTab.tsx`)

**URL construction:**

```typescript
const baseUrl = instance.tailscaleUrl
  ? `${instance.tailscaleUrl}/`
  : `http://${window.location.hostname}:${instance.port}/`;
```

Hash token appended as before: `${baseUrl}#token=${token}`.

**Button and display logic:**

- When `tailscaleUrl` is present: show the Tailscale URL as the gateway URL display, button enabled
- When `tailscaleUrl` is absent and accessing from localhost: show direct port URL, button enabled (existing behaviour)
- When `tailscaleUrl` is absent and accessing remotely (non-localhost): button disabled, tooltip reads _"Tailscale not configured — Control UI is only accessible on localhost"_, gateway URL display omitted

## Future Work

- **Device pairing UI:** `GET /api/fleet/:id/devices` and `POST /api/fleet/:id/devices/:requestId/approve` — wraps openclaw's device list/approve CLI/API. Required for first-time remote connection approval via `gateway.auth.allowTailscale`.
- **Remote instances:** When fleet manager manages openclaw on remote hosts, `TailscaleService.setup()` runs the `tailscale serve` command over SSH on the remote host. The Tailscale URL structure remains the same.

## Out of Scope

- `--network=host` Docker mode
- Tailscale inside containers
- Tailscale Funnel (public internet access)
- Automatic device pairing
