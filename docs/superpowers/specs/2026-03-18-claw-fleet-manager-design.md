# Claw Fleet Manager — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

A web-based management UI for [claw-fleet](https://github.com/qwibitai/claw-fleet) — the Docker-based multi-instance orchestration layer for OpenClaw. Replaces CLI-only workflows (`fleet.sh`, `setup.sh`) with a browser UI accessible from any device on the local network.

The manager is a **companion tool**, not a replacement — it reads and writes the same config files that the CLI uses, so both workflows remain functional.

## Goals

- View all OpenClaw instance status, health, CPU/memory at a glance
- Start, stop, restart individual instances with one click
- View and edit per-instance `openclaw.json` config in a JSON editor
- View and edit fleet-wide `fleet.env` (model settings, resource limits, scaling)
- Scale the fleet (add/remove instances, rewrites `docker-compose.yml`)
- Stream live container logs per instance
- Expose gateway tokens (masked by default, reveal on demand)
- Accessible from any LAN device, protected by HTTP Basic Auth

## Non-Goals

- No database — all state lives in Docker + files
- No cloud/remote access (LAN only)
- No user management (single admin account)
- No metrics persistence / history beyond 30 minutes in memory
- No Docker image builds or registry management

---

## Architecture

### Approach

Monorepo with two packages:

```
claw-fleet-manager/
├── package.json              # npm workspaces root
├── turbo.json                # Turborepo: dev/build pipeline
├── packages/
│   ├── server/               # Fastify backend
│   └── web/                  # React + Vite frontend
```

### Backend (`packages/server`)

**Runtime:** Node.js 20+, TypeScript
**Framework:** Fastify
**Docker integration:** dockerode (Docker socket) for all container operations. **Exception:** the scale operation shells out to `docker compose up -d` after rewriting `docker-compose.yml` — the Docker socket API has no Compose-level abstraction. The `count` parameter is validated as a positive integer before use; the shell invocation uses a fixed command with no user-controlled interpolation.

```
src/
├── index.ts                  # App entry, server startup
├── auth.ts                   # @fastify/basic-auth middleware
├── config.ts                 # Load server.config.json
├── routes/
│   ├── instances.ts          # GET /api/fleet, GET/POST lifecycle per instance
│   ├── fleet.ts              # Fleet-wide status, scale
│   ├── config.ts             # Read/write fleet.env + per-instance openclaw.json
│   └── logs.ts               # WebSocket upgrade for log streaming
├── services/
│   ├── docker.ts             # dockerode wrapper — container ops + stats
│   ├── fleet-config.ts       # Parse/write fleet.env, per-instance configs, tokens
│   └── monitor.ts            # 5s polling loop, in-memory stats cache
└── ws/
    └── logs.ts               # WebSocket handler, log buffering
```

### Frontend (`packages/web`)

**Framework:** React 18 + Vite
**UI components:** shadcn/ui (Tailwind-based)
**Data fetching:** TanStack React Query (polling + cache)
**State:** Zustand (selected instance, UI state)
**Charts:** Recharts
**Config editor:** Monaco Editor (JSON with schema validation)

```
src/
├── App.tsx
├── components/
│   ├── layout/               # Shell, sidebar, header
│   ├── instances/            # Instance list item, detail panel, controls
│   ├── logs/                 # Log viewer, WebSocket hook
│   ├── config/               # JSON editor, fleet.env form
│   └── common/               # Toast, badges, masked-value
├── hooks/
│   ├── useFleet.ts           # React Query: polls /api/fleet every 5s
│   ├── useInstanceConfig.ts  # Load/save openclaw.json
│   ├── useFleetConfig.ts     # Load/save fleet.env
│   └── useLogs.ts            # WebSocket lifecycle, 1000-line buffer
├── api/                      # fetch wrapper with auth headers
└── types/                    # Shared TypeScript types
```

---

## UI Layout

**Shell:** Instance-focused left sidebar + main content panel.

```
┌──────────────────┬─────────────────────────────────────────┐
│  ⚡ Claw Fleet   │                                         │
│                  │  openclaw-1                             │
│  ● openclaw-1    │  ● Running  port :18789  uptime 2d 4h  │
│  ● openclaw-2    │                                         │
│  ● openclaw-3    │  [Restart] [Stop] [Logs] [Config]       │
│                  │                                         │
│  ─────────────   │  ┌──────────────────────────────────┐  │
│  Fleet Config    │  │ Overview | Logs | Config | Metrics│  │
│                  │  └──────────────────────────────────┘  │
└──────────────────┴─────────────────────────────────────────┘
```

Each instance in the sidebar shows a live status dot (green/red/yellow). Clicking loads the detail panel with four tabs.

### Instance Detail Tabs

**Overview**
- Status badge, port, image version, uptime
- CPU % gauge, memory usage bar
- Start / Stop / Restart buttons
- Gateway token (masked + copy + reveal)
- WebSocket probe button

**Logs**
- Live streaming (WebSocket), auto-scroll toggle
- Filter input, log level color coding
- Clear / Download actions

**Config**
- Monaco JSON editor for `openclaw.json`
- Schema validation before save
- Atomic write (temp file + rename)
- Diff preview before confirming save

**Metrics**
- CPU/memory sparkline charts (last 30 min)
- Disk usage for workspace + config volumes

### Fleet Config (sidebar bottom)

Form for `fleet.env` fields: base URL, API key (masked), model ID, CPU/mem limits, port step, timezone.
Scale control: number input + Apply button (rewrites `docker-compose.yml`).

---

## API Design

### REST (polled every 5s by frontend)

Route registration order matters: literal paths (`/api/fleet/scale`, `/api/config/fleet`) are registered before parameterized routes (`/api/fleet/:id`) to prevent Fastify from matching literals as `:id`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fleet` | All instances: status, CPU, mem, ports, health |
| POST | `/api/fleet/scale` | Scale to N instances — registered before `/:id` |
| GET | `/api/config/fleet` | Read `fleet.env` |
| PUT | `/api/config/fleet` | Write `fleet.env` |
| POST | `/api/fleet/:id/start` | Start container — returns `{ ok: true, instance: FleetInstance }` |
| POST | `/api/fleet/:id/stop` | Stop container — returns `{ ok: true, instance: FleetInstance }` |
| POST | `/api/fleet/:id/restart` | Restart container — returns `{ ok: true, instance: FleetInstance }` |
| POST | `/api/fleet/:id/token/reveal` | Return full gateway token — POST to avoid browser/proxy logging of secrets |
| GET | `/api/fleet/:id/config` | Read `openclaw.json` |
| PUT | `/api/fleet/:id/config` | Write `openclaw.json` |
| GET | `/api/health` | Server health |

**Notes:**
- `GET /api/fleet` and `GET /api/fleet/:id` always return masked tokens (`"8155***bad5"`) — full token is never exposed in polling responses.
- Lifecycle actions (`start`/`stop`/`restart`) return the updated `FleetInstance` object so the frontend can update its React Query cache directly without a refetch.

### Scale operation

`POST /api/fleet/scale` request body:
```json
{ "count": 4 }
```

Behaviour:
1. Validates `count` is a positive integer
2. Stops and removes containers being scaled down (graceful stop, then remove)
3. Rewrites `docker-compose.yml` via the same template logic as `setup.sh`
4. Runs `docker compose up -d` to apply the new configuration
5. Returns `{ ok: true, fleet: FleetStatus }` with updated instance list

Scaling down removes the highest-indexed instances first. **Volumes are preserved** — Docker named volumes for config and workspace are not deleted, so data is retained if the fleet is scaled back up. The UI shows a confirmation dialog before scale-down that lists which instances will be stopped and reminds the user that they can scale back up to restore them.

### WebSocket

| Path | Description |
|------|-------------|
| `WS /ws/logs/:id` | Stream logs for one instance |
| `WS /ws/logs` | Stream logs from all instances (multiplexed) |

**Multiplexed log message format** (`/ws/logs`):
```json
{ "id": "openclaw-1", "line": "[2026-03-18T10:00:00Z] INFO started", "ts": 1773843758 }
```

Each message includes the instance `id` so the frontend can route lines to the correct buffer.

---

## Data Model

```typescript
interface FleetInstance {
  id: string                   // "openclaw-1"
  index: number                // 1
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown'
  port: number                 // 18789
  token: string                // always masked in API responses: "8155***bad5"
  uptime: number               // seconds
  cpu: number                  // 0-100
  memory: { used: number; limit: number }   // bytes
  disk: { config: number; workspace: number }  // bytes (from Docker volume inspect)
  health: 'healthy' | 'unhealthy' | 'starting' | 'none'
  image: string
}
```

`token` is never returned in full from any GET endpoint — full token requires `POST /api/fleet/:id/token/reveal`. Disk usage is collected via the Docker `GET /system/df` API (`dockerode.df()`) — not `VolumeInspect`, which does not include byte sizes. The `df()` response is matched to each instance's named volumes by volume name.

```typescript
interface FleetConfig {
  baseUrl: string
  apiKey: string               // masked in GET responses
  modelId: string
  count: number
  cpuLimit: string             // "4"
  memLimit: string             // "8g"
  portStep: number
  configBase: string
  workspaceBase: string
  tz: string
}
```

---

## Error Handling

- All Docker API errors return structured JSON: `{ error: string, code: string }`
- Config writes are atomic: write to temp file, then rename — no partial corruption
- WebSocket disconnects auto-reconnect (3 retries, exponential backoff), then show "reconnecting..." banner
- Frontend shows toast notifications for all action results
- Polling failures show a "connection lost" indicator without crashing the UI

---

## Security

- **HTTP Basic Auth** on all routes including WebSocket upgrades — `@fastify/basic-auth` registered globally covers the HTTP upgrade handshake for WebSocket routes registered via `@fastify/websocket`. Browser WebSocket API does not support `Authorization` headers; credentials are passed via the standard browser Basic Auth prompt on first page load and reused for WebSocket upgrade via cookie/session.
- **Docker socket** access restricted to server process only
- **API keys** masked in all GET responses, full value behind `/reveal` endpoint
- **Gateway tokens** masked by default; `POST /api/fleet/:id/token/reveal` returns the full token. This endpoint is available to any authenticated session (LAN-only tool, single admin account — accepted risk). Reveal actions are logged server-side for auditability.
- **No CORS in production** — single process serves both API and static files on one port, so all requests are same-origin. In development, Vite runs on `:5173` and the API on `:3001`; the Vite dev server proxies all `/api` and `/ws` requests to `:3001` via `vite.config.ts` `proxy` setting — no CORS configuration needed in either environment.
- **Config validation** — JSON schema check before any file write
- **`server.config.json` in `.gitignore`** — contains credentials, never committed (see Server config file section)

### Server config file (`server.config.json`)

The server resolves its config file using this lookup order:
1. Path in env var `FLEET_MANAGER_CONFIG`
2. `./server.config.json` relative to the `packages/server` package root

`server.config.json` must be in `.gitignore` — it contains credentials. The repo provides a `server.config.example.json` template with placeholder values that is safe to commit.

`fleetDir` points to the `openclaw/` subdirectory of the claw-fleet repo (e.g. `/path/to/claw-fleet/openclaw`). This is the directory that contains `docker-compose.yml`, `.env` (tokens), and `config/` (fleet.env + templates). Per-instance configs are resolved as `<configBase>/<index>/openclaw.json` where `configBase` is read from `fleet.env`.

```json
{
  "port": 3000,
  "auth": { "username": "admin", "password": "changeme" },
  "fleetDir": "/path/to/claw-fleet/openclaw"
}
```

---

## Deployment

### Development

```bash
npm install        # install all workspaces
npm run dev        # starts server (nodemon :3001) + web (vite :5173) concurrently
```

### Production

```bash
npm run build      # builds web to packages/web/dist
npm start          # server serves API + static files on one port (default: 3000)
```

Single process, single port. `@fastify/static` serves the built React app. Point a browser at `http://<lan-ip>:3000`.

### Dependencies

**Server:** `fastify`, `dockerode`, `@fastify/static`, `@fastify/basic-auth`, `@fastify/websocket`, `zod`

**Web:** `react`, `vite`, `@tanstack/react-query`, `zustand`, `shadcn/ui`, `tailwindcss`, `recharts`, `@monaco-editor/react`
