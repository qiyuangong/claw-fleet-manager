# Claw Fleet Manager — Docker Deployment

Use this when you want the fleet manager itself to run in Docker and manage Docker-backed OpenClaw instances through the host Docker daemon.

## Quick Start

```bash
chmod +x scripts/docker-deploy.sh
./scripts/docker-deploy.sh
```

Default result:

| Default | Value |
|---|---|
| Manager URL | `http://localhost:3001` |
| Admin login | `admin` / `changeme` |
| Data root | `.docker-data/claw-fleet-manager` |

## Constraints

- This deployment is for **Docker-backed instances only**.
- It mounts `/var/run/docker.sock`, so the manager controls the host Docker daemon.
- The script mounts the data directory at the **same absolute host path** inside the container, which is required for Docker bind mounts created by the manager to work correctly.
- The default OpenClaw image for new managed instances is `openclaw:local`.

## Overrides

```bash
ADMIN_USER=ops \
ADMIN_PASSWORD='change-this-now' \
MANAGER_PORT=3002 \
OPENCLAW_IMAGE=ghcr.io/your-org/openclaw:latest \
./scripts/docker-deploy.sh
```

## TLS

To enable the embedded Control UI over HTTPS, pass existing cert files:

```bash
TLS_CERT=/abs/path/cert.pem TLS_KEY=/abs/path/key.pem ./scripts/docker-deploy.sh
```

Cert paths outside the data root are mounted read-only automatically.

## Provider Defaults for New Docker Instances

Set default API credentials for newly created Docker instances:

```bash
BASE_URL=https://api.openai.com/v1 \
MODEL_ID=gpt-4o-mini \
API_KEY=sk-... \
./scripts/docker-deploy.sh
```

## Managing the Deployment

```bash
docker rm -f claw-fleet-manager        # stop and remove
docker logs -f claw-fleet-manager      # follow logs
```
