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

1. `cp packages/server/server.config.example.json packages/server/server.config.json` — set `fleetDir` to your `openclaw` directory and auth credentials
2. `cp packages/web/.env.example packages/web/.env.local` — set `VITE_BASIC_AUTH_USER` / `VITE_BASIC_AUTH_PASSWORD` to match server config

## Architecture

This is an npm workspaces monorepo (Turbo build) with two packages:

- **`packages/server`** — Fastify HTTP/WebSocket API server + Docker orchestration (Node.js, TypeScript, ES modules)
- **`packages/web`** — React 19 dashboard UI (Vite, React Query, Zustand, Recharts)

### Server (`packages/server/src/`)

**Services** (instantiated in `index.ts`, decorated onto the Fastify instance):
- **`DockerService`** — wraps Dockerode; container lifecycle (start/stop/restart), stats, log streaming, disk usage
- **`FleetConfigService`** — reads/writes `fleet.env` and per-instance `openclaw.json`; masks token values
- **`MonitorService`** — polls container stats every 5s, caches aggregated fleet state
- **`ComposeGenerator`** — generates `docker-compose.yml` for scaling; creates per-instance networks, directories, and tokens

**Routes** (`packages/server/src/routes/`):
- `health.ts` → `GET /api/health`
- `fleet.ts` → `GET /api/fleet`, `POST /api/fleet/scale`
- `instances.ts` → `POST /api/fleet/:id/{start,stop,restart}`, `POST /api/fleet/:id/token/reveal`
- `config.ts` → `GET|PUT /api/config/fleet`, `GET|PUT /api/fleet/:id/config`
- `logs.ts` → `WS /ws/logs/:id`, `WS /ws/logs` (real-time streaming)
- `proxy.ts` → `* /proxy/*`, `WS /proxy-ws/*` (reverse proxy to instances with token injection)

**Auth** (`auth.ts`): Basic Auth for HTTP; `?auth=base64` query param for WebSocket; cookie for proxy.

### Web (`packages/web/src/`)

**State**: Zustand store (`store.ts`) tracks selected instance ID and active tab.

**API**: `api/client.ts` provides `apiFetch()` with automatic Basic Auth headers from env vars.

**Data fetching**: React Query hooks — `useFleet()`, `useFleetConfig()`, `useInstanceConfig()`, `useLogs()`.

**Key component**: `InstancePanel` renders per-instance tabs: Overview, Logs (WebSocket), Config (Monaco editor), Metrics (Recharts), ControlUI (proxied iframe with hash token).

**Vite dev proxy**: `/api/*` → `http://localhost:3001`, `/ws/*` → `ws://localhost:3001`, `/proxy/*` → `http://localhost:3001`.

### Data Flow

```
Web UI → apiFetch()/WebSocket → Fastify routes → Services → Docker daemon
                                               ↘ fleet.env / openclaw.json
                                               ↘ proxy → openclaw instance
```

The server also serves the built web assets from `web/dist/` in production (single binary deploy).

## Key Types

- **`FleetInstance`**: `{ id, index, status, port, token, uptime, cpu, memory, disk, health, image }`
- **`FleetStatus`**: `{ instances: FleetInstance[], totalRunning: number, updatedAt: string }`
- **`FleetConfig`**: `{ baseUrl, apiKey, modelId, count, cpuLimit, memLimit, portStep, configBase, workspaceBase, tz }`
