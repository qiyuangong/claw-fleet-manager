# Claw Fleet Manager

<p align="center">
  <a href="README_CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <strong>Manage an OpenClaw and Hermes fleet from the browser.</strong><br/>
  Start, stop, configure, and monitor profile-based and Docker-based gateway instances from one dashboard.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge" alt="Apache 2.0 License"/>
  <img src="https://img.shields.io/badge/Node.js-20+-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 8"/>
</p>

<p align="center">
  <a href="README_CN.md">简体中文</a> ·
  <a href="docs/arch/README.md">Architecture</a> ·
  <a href="docs/guides/installation-guide.md">Installation Guide</a> ·
  <a href="docs/guides/admin-guide.md">Admin Guide</a> ·
  <a href="docs/guides/admin-quick-reference.md">Quick Reference</a> ·
  <a href="tests/README.md">Tests</a> ·
  <a href="tests/README_CN.md">测试说明（中文）</a>
</p>

<p align="center">
  <img src="docs/guides/screenshots/00-dashboard.png" alt="Claw Fleet Manager dashboard" width="900"/>
</p>

**Claw Fleet Manager** is a web UI and API server for operating multiple OpenClaw and Hermes gateway instances without living in the terminal.

It supports a **hybrid fleet** model:

- **OpenClaw profile instances** backed by native `openclaw --profile` processes
- **OpenClaw Docker instances** backed by managed `openclaw-N` containers
- **Hermes profile instances** backed by managed `hermes gateway run` homes
- **Hermes Docker instances** backed by managed Hermes gateway containers

All four can run side by side in the same fleet list, with shared lifecycle actions, logs, config editing, metrics, and access control.

## Why this project exists

Running several gateway instances quickly becomes operational work: credentials, per-instance config, logs, health checks, plugin management, and restarts. This project centralizes that work behind a browser-based control plane.

Use it when you want to:

- manage a mixed-runtime fleet instead of a single local instance
- give admins and operators a usable control surface
- monitor health, uptime, CPU, memory, and disk in one place
- inspect logs and edit per-instance config without SSH-heavy workflows
- mix native profile deployments and Docker deployments in the same environment

## What you can do

| Capability | OpenClaw profile | OpenClaw docker | Hermes profile | Hermes docker |
|---|:---:|:---:|:---:|:---:|
| Fleet overview and health metrics | ✓ | ✓ | ✓ | ✓ |
| Start / stop / restart instances | ✓ | ✓ | ✓ | ✓ |
| Live log streaming over WebSocket | ✓ | ✓ | ✓ | ✓ |
| Edit per-instance config | ✓ | ✓ | ✓ | ✓ |
| Multi-user access with admin / user roles | ✓ | ✓ | ✓ | ✓ |
| Create / remove / rename instances | ✓ | ✓ | ✓ | ✓ |
| Embedded Control UI via reverse proxy | ✓ | ✓ | — | — |
| Device approval and Feishu pairing | ✓ | ✓ | — | — |
| Install / uninstall plugins | ✓ | ✓ | — | — |
| Activity/session tab | ✓ | ✓ | — | — |
| Migrate between profile and Docker | ✓ | ✓ | — | — |
| Auto-restart on crash | ✓ | — | — | — |
| Per-instance Tailscale HTTPS URLs | — | ✓ | — | — |

## Hermes gateway support

Hermes support is currently **gateway-first**:

- the fleet manager can create, list, start, stop, restart, rename, delete, inspect logs for, and edit config for Hermes instances
- Hermes instances appear in the same fleet list as OpenClaw instances, with explicit runtime and mode labels
- OpenClaw-only surfaces such as Control UI, Feishu pairing, plugins, activity/session views, and migration remain hidden for Hermes

## Screenshots

<table>
  <tr>
    <td align="center"><b>Live Logs</b></td>
    <td align="center"><b>Metrics</b></td>
    <td align="center"><b>User Management</b></td>
  </tr>
  <tr>
    <td><img src="docs/guides/screenshots/06-logs-tab.png" alt="Live log streaming" width="260"/></td>
    <td><img src="docs/guides/screenshots/06-metrics-tab.png" alt="CPU and memory metrics" width="260"/></td>
    <td><img src="docs/guides/screenshots/03-users-panel.png" alt="User management panel" width="260"/></td>
  </tr>
</table>

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Create the server config

```bash
cp packages/server/server.config.example.json packages/server/server.config.json
```

### 3. Edit `packages/server/server.config.json`

Minimum setup:

- create the `fleetDir` directory first, then point `fleetDir` to it
- set `auth.username` and `auth.password` to seed the first admin account
- optional: set `seedTestUser: true` to also seed `testuser` with password `testuser` for local use
- remove the `tailscale` block unless you want Tailscale integration and have the CLI installed

Production hardening checklist:

- set `auth.password` to a strong value before deployment
- if you enabled `seedTestUser`, remove that account once the server is running:

```bash
curl -k -u AUTH_USERNAME:NEW_ADMIN_PASSWORD -X DELETE https://localhost:3001/api/users/testuser
```

- or delete `testuser` from `${fleetDir}/users.json` and restart

Where `AUTH_USERNAME` is the same value as `auth.username`.

Optional profile settings:

- add a `profiles` block to customize profile instance defaults such as binary path, ports, and auto-restart
- add `hermes.profiles` and `hermes.docker` blocks to customize Hermes binary, image, and base directories
- avoid using `main` as a profile name because OpenClaw reserves it for the standalone default profile

Docker behavior:

- Docker-backed instances work when Docker is available
- the fleet manager creates `config/fleet.env`, `.env`, per-instance `openclaw.json`, and workspace scaffolding as needed

TLS note:

- TLS is required for the embedded Control UI because device authentication needs a secure context
- for local development, generate a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:4096 -nodes -days 365 \
  -keyout key.pem -out cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Then set `tls.cert` and `tls.key` in `server.config.json` to those files. Your browser will warn about the self-signed cert once; accept it locally and continue.

### 4. Create the web env file

```bash
cp packages/web/.env.example packages/web/.env.local
```

Set these to match the server config:

- `VITE_BASIC_AUTH_USER`
- `VITE_BASIC_AUTH_PASSWORD`

### 5. Start the app

```bash
npm run dev
```

Default local endpoints:

- dashboard: `http://localhost:5173`
- API server: `https://localhost:3001`

## Docker deployment

Use this when you want the fleet manager itself to run in Docker and manage Docker-backed OpenClaw instances through the host Docker daemon.

One command:

```bash
chmod +x scripts/docker-deploy.sh
./scripts/docker-deploy.sh
```

Default result:

- manager URL: `http://localhost:3001`
- admin login: `admin` / `changeme`
- persistent data root: `.docker-data/claw-fleet-manager`

Important constraints:

- this Docker deployment is for **Docker-backed instances**
- it mounts `/var/run/docker.sock`, so the manager controls the host Docker daemon
- the script mounts the data directory at the **same absolute host path** inside the container, which is required for Docker bind mounts created by the manager to work correctly
- the default OpenClaw image for new managed instances is `openclaw:local`; override with `OPENCLAW_IMAGE=... ./scripts/docker-deploy.sh` if needed
- if you want embedded Control UI over HTTPS, pass existing cert files with `TLS_CERT=/abs/path/cert.pem TLS_KEY=/abs/path/key.pem ./scripts/docker-deploy.sh`; cert paths outside the data root are mounted read-only automatically

Useful overrides:

```bash
ADMIN_USER=ops \
ADMIN_PASSWORD='change-this-now' \
MANAGER_PORT=3002 \
OPENCLAW_IMAGE=ghcr.io/your-org/openclaw:latest \
./scripts/docker-deploy.sh
```

Optional provider defaults for newly created Docker instances:

```bash
BASE_URL=https://api.openai.com/v1 \
MODEL_ID=gpt-5-mini \
API_KEY=sk-... \
./scripts/docker-deploy.sh
```

Stop or replace the deployment with normal Docker commands:

```bash
docker rm -f claw-fleet-manager
docker logs -f claw-fleet-manager
```

## Repo layout

```text
.
├─ packages/server   Fastify API server, fleet backend, auth, logs, proxying
├─ packages/web      React + Vite dashboard
├─ tests/e2e         Playwright end-to-end and smoke tests
└─ docs              Architecture and operator-facing guides
```

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

For the full architecture walkthrough, see [docs/arch/README.md](docs/arch/README.md).

## Development commands

```bash
npm run dev      # start the dashboard and API server in watch mode
npm run build    # build both packages
npm run test     # run workspace tests
npm run lint     # lint the web package
npm run test:e2e # run Playwright end-to-end tests
```

For Playwright setup, environment variables, and smoke-test usage, see [tests/README.md](tests/README.md).

## Documentation

- [docs/guides/installation-guide.md](docs/guides/installation-guide.md)
- [docs/guides/admin-guide.md](docs/guides/admin-guide.md)
- [docs/guides/admin-quick-reference.md](docs/guides/admin-quick-reference.md)
- [docs/arch/README.md](docs/arch/README.md)

## License

Apache 2.0. See [LICENSE](LICENSE).
