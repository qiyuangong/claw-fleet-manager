# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm install
npm run dev              # Starts server (port 3001) and web (port 5173 via Vite proxy)

# Build
npm run build            # Compiles both packages to dist/

# Test (server only — vitest)
cd packages/server && npx vitest run
cd packages/server && npx vitest run tests/routes/fleet.test.ts  # single test file

# Lint
npm run lint             # ESLint on web package
```

## First-time Setup

1. `cp packages/server/server.config.example.json packages/server/server.config.json` — set `fleetDir` to your `openclaw` directory, auth credentials, and optionally `tailscale.hostname`
2. `cp packages/web/.env.example packages/web/.env.local` — set `VITE_BASIC_AUTH_USER` / `VITE_BASIC_AUTH_PASSWORD` to match server config

## Local Deployment Conventions

- The long-lived local deploy lives in `../claw-fleet-manager-deploy` relative to the main repo checkout (`/Users/syslab/Develop/gitremote/claw-fleet-manager-deploy` on this machine). Treat it as the runtime/deploy directory, not the active dev worktree.
- The deployed server is expected to run under tmux session `fleet-runtime-https`.
- Before redeploying, check the existing deploy first:
  - inspect tmux (`tmux ls`, `tmux capture-pane -pt fleet-runtime-https:0`)
  - inspect the current runtime PID/logs in the deploy dir (`.runtime.pid`, `.runtime.log`)
  - confirm HTTPS/server health on `https://localhost:3001/`
- Redeploys should normally sync/copy refreshed source into `../claw-fleet-manager-deploy`, while preserving deploy-only files such as `packages/server/server.config.json`, `certs/`, and runtime logs/PID files.
- After syncing, run `npm install` and `npm run build` in `../claw-fleet-manager-deploy`, then restart `node packages/server/dist/index.js` inside tmux session `fleet-runtime-https`.
- Prefer validating the deployed app against the live HTTPS endpoint (`https://localhost:3001`) after restart, including both the SPA shell/assets and authenticated API/proxy checks when credentials are available.

## Architecture

This is an npm workspaces monorepo (Turbo build) with two packages:

- **`packages/server`** — Fastify HTTP/WebSocket API server + Docker orchestration (Node.js, TypeScript, ES modules)
- **`packages/web`** — React 19 dashboard UI (Vite, React Query, Zustand, Recharts)

### Server (`packages/server/src/`)

**Services** (`packages/server/src/services/`, instantiated in `index.ts`, decorated onto the Fastify instance):
- **`DockerService`** — wraps Dockerode; container lifecycle (start/stop/restart), stats, log streaming, disk usage
- **`FleetConfigService`** — reads/writes `fleet.env` and per-instance `openclaw.json`; masks token values; atomic writes via `.tmp` + rename
- **`MonitorService`** — polls container stats every 5s, caches aggregated fleet state; populates `tailscaleUrl` from TailscaleService
- **`ComposeGenerator`** — generates `docker-compose.yml` for scaling; creates per-instance networks, directories, and tokens
- **`TailscaleService`** — manages per-instance Tailscale serve rules for remote HTTPS access; persists port map to `tailscale-ports.json`; runs preflight check + `syncAll` on startup

**Routes** (`packages/server/src/routes/`):
- `health.ts` → `GET /api/health`
- `fleet.ts` → `GET /api/fleet`, `POST /api/fleet/scale`
- `instances.ts` → `POST /api/fleet/:id/{start,stop,restart}`, `POST /api/fleet/:id/token/reveal`, `GET /api/fleet/:id/devices/pending`, `POST /api/fleet/:id/devices/:requestId/approve`
- `config.ts` → `GET|PUT /api/config/fleet`, `GET|PUT /api/fleet/:id/config`
- `logs.ts` → `WS /ws/logs/:id`, `WS /ws/logs` (real-time streaming)
- `proxy.ts` → `* /proxy/*`, `WS /proxy-ws/*` (reverse proxy to instances; injects gateway token + gateway URL into HTML via script; strips upstream CSP/X-Frame-Options; preserves WS text/binary frame type)

**Auth** (`auth.ts`): Basic Auth for HTTP; `?auth=base64` query param for WebSocket; cookie for proxy. Optional TLS via `tls` config (required for remote Control UI — secure context needed for device identity).

### Web (`packages/web/src/`)

**State**: Zustand store (`store.ts`) tracks selected instance ID and active tab.

**API**: `api/client.ts` provides `apiFetch()` with automatic Basic Auth headers from env vars.

**Data fetching**: React Query hooks — `useFleet()`, `useFleetConfig()`, `useInstanceConfig()`, `useLogs()`.

**Key component**: `InstancePanel` renders per-instance tabs: Overview, Logs (WebSocket), Config (Monaco editor), Metrics (Recharts), ControlUI (gateway URL display, token reveal, device pairing with approve-all, Tailscale-aware launch; routes through `/proxy/:id/` for remote access over HTTPS).

**Vite dev proxy**: `/api/*` → `http://localhost:3001`, `/ws/*` → `ws://localhost:3001`, `/proxy/*` → `http://localhost:3001`.

### Data Flow

```
Web UI → apiFetch()/WebSocket → Fastify routes → Services → Docker daemon
                                               ↘ fleet.env / openclaw.json
                                               ↘ proxy → openclaw instance
```

The server also serves the built web assets from `web/dist/` in production (single binary deploy).

## Key Types

- **`FleetInstance`**: `{ id, index, status, port, token, uptime, cpu, memory, disk, health, image, tailscaleUrl? }`
- **`FleetStatus`**: `{ instances: FleetInstance[], totalRunning: number, updatedAt: string }`
- **`FleetConfig`**: `{ baseUrl, apiKey, modelId, count, cpuLimit, memLimit, portStep, configBase, workspaceBase, tz }`
- **`ServerConfig`**: `{ port, auth: {username, password}, fleetDir, tailscale?: {hostname}, tls?: {cert, key} }`

## Key Constants

- `BASE_GW_PORT = 18789` — gateway port for instance-0; subsequent instances offset by `portStep`
- `BASE_TS_PORT = 8800` — Tailscale HTTPS serve port base
