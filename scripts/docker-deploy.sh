#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

resolve_path() {
  local input="$1"
  local target
  if [[ "$input" = /* ]]; then
    target="$input"
  else
    target="$ROOT_DIR/$input"
  fi

  local dir
  dir=$(dirname "$target")
  mkdir -p "$dir"
  dir=$(cd "$dir" && pwd -P)
  printf '%s/%s\n' "$dir" "$(basename "$target")"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_command docker

IMAGE_TAG=${IMAGE_TAG:-claw-fleet-manager:local}
CONTAINER_NAME=${CONTAINER_NAME:-claw-fleet-manager}
MANAGER_PORT=${MANAGER_PORT:-3001}
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme}
OPENCLAW_IMAGE=${OPENCLAW_IMAGE:-openclaw:local}
ENABLE_NPM_PACKAGES=${ENABLE_NPM_PACKAGES:-false}
PORT_STEP=${PORT_STEP:-20}
FLEET_TZ=${FLEET_TZ:-${TZ:-UTC}}
DATA_ROOT=$(resolve_path "${DATA_ROOT:-.docker-data/claw-fleet-manager}")
FLEET_DIR="$DATA_ROOT/fleet"
BASE_DIR="$DATA_ROOT/instances"
CONFIG_PATH="$DATA_ROOT/server.config.json"
FLEET_ENV_PATH="$FLEET_DIR/config/fleet.env"

TLS_BLOCK=""
if [[ -n "${TLS_CERT:-}" || -n "${TLS_KEY:-}" ]]; then
  if [[ -z "${TLS_CERT:-}" || -z "${TLS_KEY:-}" ]]; then
    printf 'Set both TLS_CERT and TLS_KEY, or neither.\n' >&2
    exit 1
  fi

  TLS_CERT=$(resolve_path "$TLS_CERT")
  TLS_KEY=$(resolve_path "$TLS_KEY")

  if [[ ! -f "$TLS_CERT" ]]; then
    printf 'TLS_CERT does not exist: %s\n' "$TLS_CERT" >&2
    exit 1
  fi
  if [[ ! -f "$TLS_KEY" ]]; then
    printf 'TLS_KEY does not exist: %s\n' "$TLS_KEY" >&2
    exit 1
  fi

  TLS_BLOCK=$(cat <<EOF
,
  "tls": {
    "cert": "$(json_escape "$TLS_CERT")",
    "key": "$(json_escape "$TLS_KEY")"
  }
EOF
)
fi

TAILSCALE_BLOCK=""
if [[ -n "${TAILSCALE_HOSTNAME:-}" ]]; then
  TAILSCALE_BLOCK=$(cat <<EOF
,
  "tailscale": {
    "hostname": "$(json_escape "$TAILSCALE_HOSTNAME")"
  }
EOF
)
fi

mkdir -p "$FLEET_DIR/config" "$BASE_DIR"

cat > "$CONFIG_PATH" <<EOF
{
  "port": $MANAGER_PORT,
  "auth": {
    "username": "$(json_escape "$ADMIN_USER")",
    "password": "$(json_escape "$ADMIN_PASSWORD")"
  },
  "fleetDir": "$(json_escape "$FLEET_DIR")",
  "baseDir": "$(json_escape "$BASE_DIR")"$TAILSCALE_BLOCK$TLS_BLOCK
}
EOF

if [[ ! -f "$FLEET_ENV_PATH" ]]; then
  {
    printf 'OPENCLAW_IMAGE=%s\n' "$OPENCLAW_IMAGE"
    printf 'ENABLE_NPM_PACKAGES=%s\n' "$ENABLE_NPM_PACKAGES"
    printf 'PORT_STEP=%s\n' "$PORT_STEP"
    printf 'TZ=%s\n' "$FLEET_TZ"
    if [[ -n "${BASE_URL:-}" ]]; then
      printf 'BASE_URL=%s\n' "$BASE_URL"
    fi
    if [[ -n "${MODEL_ID:-}" ]]; then
      printf 'MODEL_ID=%s\n' "$MODEL_ID"
    fi
    if [[ -n "${API_KEY:-}" ]]; then
      printf 'API_KEY=%s\n' "$API_KEY"
    fi
  } > "$FLEET_ENV_PATH"
fi

docker build -t "$IMAGE_TAG" "$ROOT_DIR"

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p "$MANAGER_PORT:$MANAGER_PORT" \
  -e "FLEET_MANAGER_CONFIG=$CONFIG_PATH" \
  -e "OPENCLAW_UPSTREAM_HOST=host.docker.internal" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$DATA_ROOT:$DATA_ROOT" \
  "$IMAGE_TAG"

PROTO=http
if [[ -n "$TLS_BLOCK" ]]; then
  PROTO=https
fi

printf 'Claw Fleet Manager is running at %s://localhost:%s\n' "$PROTO" "$MANAGER_PORT"
printf 'Container: %s\n' "$CONTAINER_NAME"
printf 'Data root: %s\n' "$DATA_ROOT"
printf 'Admin user: %s\n' "$ADMIN_USER"
printf 'Docker instance image default: %s\n' "$OPENCLAW_IMAGE"
