# Tailscale Serve Integration for Control UI Remote Access

**Date:** 2026-03-22
**Status:** Approved

## Problem

The Control UI currently opens via a direct URL (`http://{host}:{port}/#token={token}`), which only works on localhost. Remote browsers cannot reach openclaw instance ports directly. Even if ports were opened, openclaw rejects non-HTTPS remote connections (WebCrypto requires a secure context), and Docker bridge networking means connections from the fleet manager proxy arrive at the container as `172.x.x.x` — treated as remote by openclaw's auth policy.

## Solution

Use Tailscale Serve on the host to expose each openclaw instance with HTTPS on the tailnet. Configure openclaw with `gateway.auth.allowTailscale: true` so it authenticates connections via Tailscale identity headers rather than source IP. The fleet manager manages the `tailscale serve` lifecycle per instance.

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
    └─ allowedOrigins: [fleet manager tailscale URL]
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

**Port allocation:** `BASE_TS_PORT (8800) + (index - 1) * portStep`

**Persistence:** `{fleetDir}/tailscale-ports.json` stores `{ [index]: tsPort }` so URLs survive fleet manager restarts. `tailscale serve` configs persist in Tailscale's own state; the file is only needed to rebuild the in-memory URL map.

```typescript
class TailscaleService {
  // Runs: tailscale serve --bg --https={tsPort} localhost:{gwPort}
  // Verifies via: tailscale serve status --json
  // Returns the HTTPS URL
  async setup(index: number, gwPort: number): Promise<string>

  // Runs: tailscale serve --bg --https={tsPort} off
  async teardown(index: number): Promise<void>

  // Returns stored URL for an index (undefined if not configured)
  getUrl(index: number): string | undefined

  // On fleet manager startup: rebuilds in-memory URL map from persisted ports
  // Does not re-run serve commands (Tailscale state already persists them)
  async syncAll(instances: { index: number; gwPort: number }[]): Promise<void>
}
```

### 4. `ComposeGenerator` (`packages/server/src/services/compose-generator.ts`)

`generate(count: number, tailscaleHostname?: string): void`

When `tailscaleHostname` is provided, writes `{configDir}/openclaw.json` for each **new** instance (skips existing to avoid overwriting user customisation):

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
  "allowedOrigins": ["https://{tailscaleHostname}"]
}
```

No changes to the Docker Compose command (`--bind lan` stays). No changes to existing instances on re-scale.

### 5. `MonitorService` (`packages/server/src/services/monitor.ts`)

Receives a `TailscaleService | null` reference. When building `FleetInstance` objects, populates `tailscaleUrl` from `tailscaleService.getUrl(index)`.

### 6. Fleet scale route (`packages/server/src/routes/fleet.ts`)

After `composeGenerator.generate()` and `docker compose up`:

- For each **new** instance index: call `tailscaleService.setup(index, gwPort)`
- For each **removed** instance index: call `tailscaleService.teardown(index)`

### 7. `index.ts`

- Conditionally instantiate `TailscaleService` when `config.tailscale` is present
- Pass to `MonitorService` and fleet route
- Call `tailscaleService.syncAll(existingInstances)` on startup

### 8. `ControlUiTab` (`packages/web/src/components/instances/ControlUiTab.tsx`)

```typescript
const baseUrl = instance.tailscaleUrl
  ? `${instance.tailscaleUrl}/`
  : `http://${window.location.hostname}:${instance.port}/`;
```

Hash token is appended as before: `${baseUrl}#token=${token}`.

When `tailscaleUrl` is absent and the page is not on localhost, the "Open Control UI" button is disabled with a tooltip: _"Tailscale not configured — Control UI is only accessible on localhost."_

## Future Work

- **Device pairing UI:** `GET /api/fleet/:id/devices` and `POST /api/fleet/:id/devices/:requestId/approve` — wraps openclaw's device list/approve CLI/API. Required for first-time remote connection approval.
- **Remote instances:** When fleet manager manages openclaw on remote hosts, `TailscaleService.setup()` runs the `tailscale serve` command over SSH on the remote host. The Tailscale URL structure remains the same.

## Out of Scope

- `--network=host` Docker mode
- Tailscale inside containers
- Tailscale Funnel (public internet access)
- Automatic device pairing
