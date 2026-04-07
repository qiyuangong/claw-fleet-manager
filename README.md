# Claw Fleet Manager

[简体中文](README_CN.md)

Manage an `openclaw` fleet from a browser — start, stop, configure, and monitor instances without touching the command line.

The server runs a single **hybrid** backend that supports both instance types simultaneously:

- **Profile instances** — native `openclaw --profile` gateway processes with auto-restart and full lifecycle management
- **Docker instances** — `openclaw-N` containers managed directly, including per-instance config and workspace provisioning

Both types can coexist in the same fleet.

## Features

| Feature | Profile instances | Docker instances |
|---|:---:|:---:|
| Fleet overview (health, CPU, memory, disk, uptime) | ✓ | ✓ |
| Start / stop / restart | ✓ | ✓ |
| Live log streaming over WebSocket | ✓ | ✓ |
| Per-instance `openclaw.json` editing | ✓ | ✓ |
| Embedded Control UI via reverse proxy | ✓ | ✓ |
| Device approval and Feishu pairing | ✓ | ✓ |
| Multi-user access with admin/user roles | ✓ | ✓ |
| Create / remove instances | ✓ | ✓ |
| Plugin install / uninstall | ✓ | ✓ |
| Migrate between instance types | ✓ | ✓ |
| Auto-restart on crash | ✓ | — |
| Tailscale per-instance HTTPS URLs | — | ✓ |

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create the server config:

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

3. Edit `packages/server/server.config.json`:
   - Set `fleetDir` to your fleet directory
   - `auth.username` / `auth.password` seed the first admin account on startup
   - Optionally add a `profiles` block to customize profile instance settings (binary path, ports, auto-restart, etc. — see example config). Profile support is always active with built-in defaults. Avoid using `main` as a profile name — OpenClaw reserves that name for the standalone default profile.
   - Docker instances work out of the box when Docker is available. The fleet manager creates `config/fleet.env`, `.env`, per-instance `openclaw.json`, and workspace scaffolding as needed — no `docker compose` or external setup script required.
   - **TLS** — TLS is required for the Control UI (device auth needs a secure context). Generate a self-signed cert for local development:
     ```bash
     openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
       -keyout key.pem -out cert.pem \
       -subj "/CN=localhost" \
       -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
     ```
     Then set `tls.cert` and `tls.key` in `server.config.json` to the paths of the generated files. Your browser will show a security warning for a self-signed cert — accept it once to proceed.

4. Create the web env file:

```bash
cp packages/web/.env.example packages/web/.env.local
```

5. Set `VITE_BASIC_AUTH_USER` and `VITE_BASIC_AUTH_PASSWORD` in `.env.local` to match the server config.

6. Start:

```bash
npm run dev
```

Dashboard runs at `http://localhost:5173`, API server at `https://localhost:3001` (or `http://` if you removed TLS).

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  Browser  →  React Dashboard (Vite)  →  Fastify API Server  │
│                                           ├─ Auth + Users   │
│                                           ├─ Fleet config   │
│                                           └─ Logs / Proxy   │
└─────────────────────────────────────────────────────────────┘
                              │
                    HybridBackend (always active)
              ┌───────────────┴───────────────┐
      ProfileBackend                    DockerBackend
  openclaw --profile <name>          openclaw-N containers
  config / state / workspace         per-instance config / workspace
```

See [docs/arch/README.md](docs/arch/README.md) for the full architecture walkthrough.

For day-to-day admin workflows see [docs/guides/admin-guide.md](docs/guides/admin-guide.md) and the [quick reference](docs/guides/admin-quick-reference.md).

## Commands

```bash
npm run dev      # start server (port 3001) and dashboard (port 5173)
npm run build    # compile both packages
npm run test     # run server tests
npm run lint     # lint the web package
npm run test:e2e # run Playwright smoke tests against a configured deployment
```

## Playwright Smoke Tests

`npm run test:e2e` needs either a running dashboard URL or a command that Playwright can use to start one:

```bash
# Point at an existing deployment
PLAYWRIGHT_BASE_URL=https://localhost:3001 npm run test:e2e

# Or let Playwright boot the app for the test run
PLAYWRIGHT_SERVER_COMMAND="npm run dev" PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npm run test:e2e
```

The auth smoke tests also read credentials from environment variables and skip cleanly when they are not provided:

```bash
PLAYWRIGHT_USER_USERNAME=qiyuan \
PLAYWRIGHT_USER_PASSWORD=1234qwer \
PLAYWRIGHT_ADMIN_USERNAME=admin \
PLAYWRIGHT_ADMIN_PASSWORD=bigdl123 \
PLAYWRIGHT_BASE_URL=https://localhost:3001 \
npm run test:e2e
```

## License

Apache 2.0. See [LICENSE](LICENSE).
