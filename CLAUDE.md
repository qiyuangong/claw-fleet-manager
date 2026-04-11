# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run test:e2e

cd packages/server && npx vitest run
cd packages/server && npx vitest run tests/routes/fleet.test.ts
```

## First-Time Setup

1. `cp packages/server/server.config.example.json packages/server/server.config.json`
   - set `fleetDir` to a fleet runtime/data directory
   - set `auth.username` / `auth.password` for initial admin bootstrap
   - configure `tls` if you need local HTTPS for the embedded Control UI
   - add `tailscale` only if you want it and the CLI is installed
2. `cp packages/web/.env.example packages/web/.env.local`
   - set `VITE_BASIC_AUTH_USER` / `VITE_BASIC_AUTH_PASSWORD` to match server auth

## Repo Mental Model

- `packages/server`: Fastify API server, auth, fleet backends, logs, proxying
- `packages/web`: React 19 + Vite dashboard
- `tests/e2e`: Playwright tests
- `docs/arch`: architecture docs

This repo supports two deployment backends behind one control plane:

- `profiles`: native `openclaw --profile <name>` processes
- `docker`: managed `openclaw-N` containers

## Server Mental Model

- loads and validates `server.config.json`
- bootstraps `FleetConfigService` and `UserService`
- constructs the active backend for the configured deployment mode
- registers auth, authorization, WebSocket routes, API routes, proxy routes, and static asset serving
- serves `packages/web/dist` in production when available

Important server components:

- `DockerBackend`
- `ProfileBackend`
- `FleetConfigService`
- `UserService`
- `DockerService`
- `TailscaleService`
- `docker-instance-provisioning`

Important route groups in `packages/server/src/routes`:

- `health.ts`
- `fleet.ts`
- `config.ts`
- `instances.ts`
- `users.ts`
- `logs.ts`
- `proxy.ts`
- `plugins.ts`

Profile mode also registers profile-management routes.

## Auth And Validation

- HTTP API uses Basic Auth
- WebSocket and proxy bootstrap may use `?auth=<base64(username:password)>`
- proxied Control UI traffic uses a cookie / proxy-token flow
- `admin` users can access everything
- non-admin users are limited to assigned profiles

Validation rules to remember:

- Docker instance IDs: `openclaw-<number>`
- Profile instance IDs: lowercase alphanumeric plus hyphen, and not Docker-style

## Web Mental Model

- React Query handles server synchronization
- Zustand stores selected view, active tab, and user snapshot
- Monaco is used for config editing
- Recharts is used for metrics
- Vite proxies `/api/*`, `/ws/*`, and `/proxy/*` to the Fastify server during development

## Local Deployment Conventions

- the long-lived local deploy lives in `../claw-fleet-manager-deploy`
- treat it as a runtime copy, not the main development worktree
- expected tmux session: `fleet-runtime-https`
- prefer HTTPS at `https://localhost:3001` when local TLS is available

Before redeploying:

- inspect `tmux ls`
- inspect `tmux capture-pane -pt fleet-runtime-https:0`
- inspect `.runtime.pid` and `.runtime.log`
- check health on `https://localhost:3001/`

Redeploy pattern:

- sync refreshed source into `../claw-fleet-manager-deploy`
- preserve deploy-only files such as `packages/server/server.config.json`, `certs/`, runtime logs, and PID files
- run `npm install` and `npm run build` in the deploy dir
- restart `node packages/server/dist/index.js` inside `fleet-runtime-https`

Operational notes:

- prefer `.runtime.log` over tmux pane output for runtime debugging
- do not assume bootstrap auth in `server.config.json` still matches live credentials
- if profile mode is unavailable locally, fall back to Docker mode
- a restart may adopt existing profile gateways instead of recreating them

## Runtime Files

Common persisted files:

- `fleetDir/users.json`
- `fleetDir/profiles.json`
- `fleetDir/tailscale-ports.json`
- `fleetDir/.env`
- `fleetDir/config/fleet.env`
- per-instance `openclaw.json`

In profile mode, config/state/workspace directories may also live under the configured profile base directories outside `fleetDir`.

## Docs

- `README.md`
- `README_CN.md`
- `docs/arch/README.md`
- `docs/arch/README_CN.md`
- `tests/README.md`
- `tests/README_CN.md`
