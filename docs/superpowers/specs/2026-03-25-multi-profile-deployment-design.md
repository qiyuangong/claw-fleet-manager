# Multi-Profile Deployment Design

**Date:** 2026-03-25
**Status:** Approved
**Topic:** Support OpenClaw native profile-based deployment as an alternative to Docker

---

## Overview

Add a second deployment backend — **profile mode** — that runs OpenClaw instances directly on the host using the `openclaw --profile <name> gateway` CLI, as an alternative to the existing Docker-based deployment. Both modes share the same web UI and API surface. The deployment mode is set in `server.config.json` and cannot be changed at runtime.

---

## 1. Architecture: Backend Strategy Pattern

A `DeploymentBackend` interface decouples lifecycle, monitoring, log, config, and command operations from their concrete implementations. Both Docker and Profile modes implement this interface.

```
DeploymentBackend (interface)
├── DockerBackend   — wraps existing DockerService + ComposeGenerator + MonitorService
└── ProfileBackend  — manages host processes via openclaw CLI
```

The appropriate backend is instantiated in `index.ts` based on `config.deploymentMode` and decorated onto the Fastify instance as `fastify.backend`. A companion `fastify.deploymentMode` decorator (`'docker' | 'profiles'`) is set at startup for synchronous access in routes. Routes operate against these decorators rather than concrete service instances.

```typescript
// Returned by streamLogs / streamAllLogs — callers call stop() on WebSocket close
interface LogHandle {
  stop(): void;
}

// Fields used by createInstance() vary by backend (see Section 2 and 3)
interface CreateInstanceOpts {
  name?: string;     // profile mode: required. Docker mode: ignored.
  port?: number;     // profile mode: auto-assigned if omitted. Docker mode: ignored.
  config?: object;   // profile mode: written to openclaw.json. Docker mode: ignored.
}

interface DeploymentBackend {
  // Lifecycle
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;

  // Scaling / management
  createInstance(opts: CreateInstanceOpts): Promise<FleetInstance>;
  removeInstance(id: string): Promise<void>;

  // Monitoring — replaces MonitorService
  // getCachedStatus() is synchronous — used by GET /api/fleet for zero-latency reads
  getCachedStatus(): FleetStatus | null;
  // refresh() polls sources, updates the cache, returns fresh FleetStatus
  // called after lifecycle mutations and on the internal polling interval
  refresh(): Promise<FleetStatus>;

  // Logs
  streamLogs(id: string, onData: (line: string) => void): LogHandle;
  streamAllLogs(onData: (id: string, line: string) => void): LogHandle;

  // In-process commands — args are tokens after `node dist/index.js` / `openclaw --profile <name>`
  execInstanceCommand(id: string, args: string[]): Promise<string>;

  // Token management
  revealToken(id: string): Promise<string>;

  // Per-instance config (openclaw.json)
  readInstanceConfig(id: string): Promise<object>;
  writeInstanceConfig(id: string, config: object): Promise<void>;

  // Init & teardown
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
```

**`MonitorService` is absorbed into `DockerBackend`.** It is no longer a separate Fastify decorator. `app.monitor` is replaced by `app.backend`. `app.docker`, `app.composeGenerator`, `app.tailscale`, and `app.tailscaleHostname` are no longer needed as separate decorators once their logic moves into `DockerBackend` — they can remain internal to the backend class.

---

## 2. Type Changes (`types.ts`)

```typescript
interface FleetStatus {
  mode: 'docker' | 'profiles';  // new field
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;             // unchanged — Unix ms timestamp
}

interface FleetInstance {
  id: string;
  index?: number;                // optional: present in Docker mode (1-based), absent in profile mode
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;         // absent in profile mode (Tailscale not supported in profile mode v1)
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;                 // Docker mode: image ID. Profile mode: absolute path to openclaw binary.
  profile?: string;              // profile mode only: the profile name
}

interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  tailscale?: { hostname: string };
  tls?: { cert: string; key: string };
  deploymentMode?: 'docker' | 'profiles';  // defaults to 'docker'
  profiles?: ProfilesConfig;               // only used when deploymentMode = 'profiles'
}

interface ProfilesConfig {
  openclawBinary: string;   // default: 'openclaw'
  basePort: number;         // default: 18789
  portStep: number;         // default: 20
  stateBaseDir: string;     // base dir for per-profile state dirs; ~ is expanded
  configBaseDir: string;    // base dir for per-profile config dirs; ~ is expanded
  autoRestart: boolean;     // default: true
  stopTimeoutMs: number;    // default: 10000
}
```

`FleetInstance.index` is made optional so profile-mode instances omit it. Any existing code that reads `instance.index` without a guard will need a null-check. The only callers in the current codebase are inside `MonitorService` (absorbed into `DockerBackend`) and `fleet.ts` Tailscale logic (moved into `DockerBackend`) — both are internal to `DockerBackend` and remain safe.

---

## 3. `profiles.json` Schema

`profiles.json` lives at `${fleetDir}/profiles.json`. It is the sole source of truth for registered profiles; `status` is **not** stored — it is always derived at runtime from PID liveness and healthz polling.

```typescript
interface ProfileEntry {
  name: string;
  port: number;
  pid: number | null;    // null when stopped; set when process is running
  configPath: string;    // absolute path: ${configBaseDir}/<name>/openclaw.json
  stateDir: string;      // absolute path: ${stateBaseDir}/<name>
}

interface ProfileRegistry {
  profiles: Record<string, ProfileEntry>;  // keyed by profile name
  nextPort: number;                         // next auto-assignable port
}
```

Example:
```json
{
  "profiles": {
    "main":   { "name": "main",   "port": 18789, "pid": 12345, "configPath": "/home/user/.openclaw-configs/main/openclaw.json",   "stateDir": "/home/user/.openclaw-states/main" },
    "rescue": { "name": "rescue", "port": 18809, "pid": null,  "configPath": "/home/user/.openclaw-configs/rescue/openclaw.json", "stateDir": "/home/user/.openclaw-states/rescue" }
  },
  "nextPort": 18829
}
```

---

## 4. Instance ID Validation (`validate.ts`)

Updated to support both modes. Routes get the mode from `app.deploymentMode` (a `'docker' | 'profiles'` string decorated onto Fastify in `index.ts` at startup — synchronous, no async call needed).

```typescript
export const DOCKER_INSTANCE_ID_RE = /^openclaw-\d+$/;
export const PROFILE_INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function validateInstanceId(id: string, mode: 'docker' | 'profiles'): boolean {
  return mode === 'docker'
    ? DOCKER_INSTANCE_ID_RE.test(id)
    : PROFILE_INSTANCE_ID_RE.test(id);
}
```

`fastify.d.ts` gains:
```typescript
deploymentMode: 'docker' | 'profiles';
backend: DeploymentBackend;
```
And removes: `monitor: MonitorService` (absorbed into backend).

---

## 5. ProfileBackend

### Process Management

- Spawns `openclaw --profile <name> gateway --port <port>` via `child_process.spawn()` (stdio piped to log file)
- Stdout/stderr written to `${fleetDir}/logs/<profile-name>.log`
- PIDs tracked in `profiles.json` (field `pid`), validated on startup
- Graceful stop: `SIGTERM` with `stopTimeoutMs`, then `SIGKILL`
- Per-instance mutex: `Map<string, boolean>` inside `ProfileBackend`; lifecycle ops check and set this map

### Instance Creation

1. Validate profile name format; reject duplicates
2. Assign port: user-specified or auto-assign from `nextPort`; probe port is not already bound (`net.createServer` probe)
3. Run `openclaw --profile <name> setup` to initialize config/state dirs
4. Write any custom `config` object to `${configBaseDir}/<name>/openclaw.json`
5. Register entry in `profiles.json` with `pid: null`
6. Start gateway process; update `pid` in `profiles.json`

### Instance Removal

1. Stop process if running
2. Remove entry from `profiles.json`
3. Leave state/config dirs on disk (no accidental data loss)

### Health Monitoring

- Internal 5s polling loop matching current Docker mode interval
- Polls `http://127.0.0.1:<port>/healthz`; falls back to `kill(pid, 0)` liveness check
- **CPU (Linux):** reads `/proc/<pid>/stat` at two points 1s apart; computes `(delta_utime + delta_stime) / elapsed_jiffies * 100`
- **CPU (macOS):** `ps -p <pid> -o %cpu=` (single sample; sufficient for dashboard display)
- **Memory (Linux):** `VmRSS` from `/proc/<pid>/status` (bytes = value_kB * 1024)
- **Memory (macOS):** `ps -p <pid> -o rss=` (KB → bytes)
- **Disk:** `getDirectorySize(configPath directory)` and `getDirectorySize(stateDir)` — reuse `MonitorService.getDirectorySize()` logic (extract as shared utility)
- **Image:** absolute path to the openclaw binary (resolved once in `initialize()` via `which openclaw` or config `openclawBinary`)
- **`uptime`:** `Date.now() - processStartTime` where start time is recorded when `start()` is called

### Crash Recovery (`autoRestart`)

- `'exit'` event on the spawned child process triggers recovery
- Wait 2s (debounce), then call `start(id)`
- If the process exits again within 5s of the restart, mark status `unhealthy` and stop retrying until user manually calls `start()`
- Crash and recovery events logged to server log and instance log file

### Log Streaming

- `streamLogs(id)`: opens read stream on `${fleetDir}/logs/<profile-name>.log`, tails via `fs.watch`; `stop()` removes watcher and closes stream
- `streamAllLogs()`: calls `streamLogs()` per registered profile in parallel, prefixes lines with profile name; `stop()` calls all child `stop()`s

### In-Process Commands

- `execInstanceCommand(id, args)`: runs `openclaw --profile <name> <...args>` via `execFile`; returns stdout
- On non-zero exit: throws with stderr as message; routes return **500** (matching existing Docker behavior — no behavior divergence between modes)
- Canonical args mapping (matches existing `instances.ts` Docker exec shapes):
  - `['devices', 'list']` → `openclaw --profile <name> devices list`
  - `['devices', 'approve', requestId]` → `openclaw --profile <name> devices approve <requestId>`
  - `['pairing', 'list', 'feishu']` → `openclaw --profile <name> pairing list feishu`
  - `['pairing', 'approve', 'feishu', code]` → `openclaw --profile <name> pairing approve feishu <code>`

### Token Management

- `revealToken(id)`: reads `gateway.auth.token` from `${configBaseDir}/<name>/openclaw.json`

### Per-Instance Config

- `readInstanceConfig(id)`: reads and parses `${configBaseDir}/<name>/openclaw.json`
- `writeInstanceConfig(id, config)`: atomically writes via `.tmp` + rename

### Startup Recovery

- Reads `profiles.json`; for each entry with `pid !== null`:
  - `kill(pid, 0)` — if throws, PID is gone; set `pid: null`
  - Verify cmdline contains `openclaw` and `--profile <name>` (Linux: `/proc/<pid>/cmdline`; macOS: `ps -p <pid> -o command=`)
  - If cmdline belongs to a different process, clear `pid: null`
  - Otherwise adopt as running
- If `autoRestart` is enabled, previously-running instances (where `pid` was set but process is now gone) are restarted

### Tailscale

Not supported in profile mode in this iteration. The `tailscale` config key is ignored by `ProfileBackend`. All `FleetInstance` objects from `ProfileBackend` have no `tailscaleUrl`.

---

## 6. DockerBackend Refactor

Wraps existing logic with minimal behavior change. `MonitorService` is absorbed. The Tailscale orchestration currently in `fleet.ts` (port allocation, setup, teardown) moves **into** `DockerBackend.createInstance()` and `DockerBackend.removeInstance()` — `fleet.ts` becomes a thin delegating route.

| Current location | Moves to |
|---|---|
| `DockerService` container ops | `DockerBackend.start/stop/restart()` |
| `ComposeGenerator` + `docker compose up` | `DockerBackend.createInstance()` (count-based; `CreateInstanceOpts` fields unused) |
| Tailscale allocate/setup in `fleet.ts` | `DockerBackend.createInstance()` |
| Tailscale teardown in `fleet.ts` | `DockerBackend.removeInstance()` |
| `MonitorService` polling + cache | `DockerBackend.getCachedStatus()` + `refresh()` + internal `setInterval` |
| Docker log streaming | `DockerBackend.streamLogs()` + `streamAllLogs()` |
| `docker exec node dist/index.js <args>` | `DockerBackend.execInstanceCommand()` |
| Token lookup from `.env` by numeric index | `DockerBackend.revealToken()` |
| `fleetConfig.readInstanceConfig(index)` | `DockerBackend.readInstanceConfig(id)` (parses `id` → index, delegates to `fleetConfig`) |
| `fleetConfig.writeInstanceConfig(index)` | `DockerBackend.writeInstanceConfig(id, cfg)` |

**`createInstance` in Docker mode:** increments stored count by 1, calls `composeGenerator.generate()`, runs `docker compose up -d --remove-orphans`, sets up Tailscale for the new index, calls `refresh()`, returns new `FleetInstance`. `CreateInstanceOpts` fields are ignored.

**`removeInstance` in Docker mode:** tears down Tailscale for the highest index, stops its container, decrements count, recomposes. The `id` argument is accepted for interface compliance but Docker mode always removes the last (highest-index) instance.

`FleetConfigService` remains unchanged and stays as a Fastify decorator for `config.ts` fleet-wide config routes.

---

## 7. Route Changes

### `fleet.ts`

Before (current):
```typescript
app.get('/api/fleet', async () => {
  const status = app.monitor.getStatus();
  return status ?? { instances: [], totalRunning: 0, updatedAt: Date.now() };
});
```

After:
```typescript
app.get('/api/fleet', async () => {
  return app.backend.getCachedStatus()
    ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
});
```

`POST /api/fleet/scale` delegates to `app.backend.createInstance()` / `app.backend.removeInstance()` for the diff between current and target count. Returns 400 in profile mode.

### `instances.ts`

All `app.docker.*` and `app.monitor.*` calls replaced with `app.backend.*`. The `execFileAsync('docker', ['exec', ...])` calls replaced with `app.backend.execInstanceCommand(id, args)`. All `validateInstanceId(id)` calls updated to `validateInstanceId(id, app.deploymentMode)`.

### `config.ts`

`parseInt(id.replace('openclaw-', ''), 10)` + `app.fleetConfig.readInstanceConfig(index)` replaced with `app.backend.readInstanceConfig(id)` and `app.backend.writeInstanceConfig(id, cfg)`. `validateInstanceId` updated as above.

### `logs.ts`

`app.docker.*` log streaming replaced with `app.backend.streamLogs()` and `app.backend.streamAllLogs()`. WebSocket close handlers call `handle.stop()`.

### New: `routes/profiles.ts`

Registered only in profile mode. Docker mode skips this registration.

```
POST   /api/fleet/profiles          — createInstance(); returns FleetInstance
DELETE /api/fleet/profiles/:name    — removeInstance(name)
GET    /api/fleet/profiles          — backend.getCachedStatus()?.instances
```

---

## 8. Web UI Adaptation

The UI adapts based on `mode` from `GET /api/fleet`. No runtime toggle.

**Fleet overview bar:**
- Docker mode: count slider + Scale button (unchanged)
- Profile mode: "Add Profile" button instead of slider

**"Add Profile" dialog (new):**
- Fields: name (required), port (optional, shows auto-assigned default), custom config JSON (optional, Monaco editor)
- Validation: name format, port conflict via API response

**Instance panel:**
- Profile name as primary label; PID shown in Overview tab instead of container ID / image
- Logs, Config, ControlUI, Metrics tabs: unchanged

**API client (`api/fleet.ts`):**
- `createProfile(opts: { name: string; port?: number; config?: object })`
- `deleteProfile(name: string)`
- `useFleet()` exposes `mode` from `FleetStatus`

---

## 9. Configuration

**`server.config.json` (profile mode example):**

```json
{
  "port": 3001,
  "deploymentMode": "profiles",
  "auth": { "username": "admin", "password": "..." },
  "fleetDir": "/home/user/openclaw-fleet",
  "profiles": {
    "openclawBinary": "openclaw",
    "basePort": 18789,
    "portStep": 20,
    "stateBaseDir": "~/.openclaw-states",
    "configBaseDir": "~/.openclaw-configs",
    "autoRestart": true,
    "stopTimeoutMs": 10000
  }
}
```

`deploymentMode` defaults to `"docker"` — existing deployments need no config changes.

---

## 10. Error Handling & Edge Cases

| Scenario | Handling |
|---|---|
| Process crashes | Status → `stopped`; if `autoRestart`, wait 2s then restart; if re-exits within 5s → `unhealthy` |
| Port conflict on creation | Probe before creating; return 409 |
| Stale PID on startup | Validate cmdline; clear `pid` to null if stale |
| `openclaw` binary not found | `initialize()` fails fast; server refuses to start |
| Concurrent lifecycle ops | Per-instance `Map<string, boolean>` mutex; return 409 if locked |
| Server restart | Processes left running; re-adopted on next startup |
| Wrong scaling endpoint | Return 400 with mode-specific message |
| `execInstanceCommand` failure | Throw with stderr; route returns 500 (same as Docker mode) |

---

## 11. Testing Strategy

**Unit tests (vitest):**
- `ProfileBackend`: mock `child_process.spawn`/`execFile`, `fs`, HTTP health checks
- CPU/memory stat parsing for Linux (`/proc`) and macOS (`ps`) formats
- Stale PID detection and cleanup; crash recovery debounce
- Shared compliance suite: same behavioral assertions run against both `DockerBackend` and `ProfileBackend` with mocked dependencies

**Integration tests (require `openclaw` binary; skipped in CI via `describe.skipIf`):**
- Full lifecycle: create → start → health check passes → stop → remove
- Port conflict: second profile on same port → expect 409
- Log streaming via WebSocket
- `execInstanceCommand` round-trip for device and Feishu pairing

**API route tests:**
- Profile CRUD with mocked backend
- `GET /api/fleet` returns correct `mode`
- Cross-mode endpoints return 400
- Existing Docker route tests adapted for `DockerBackend` wrapper

---

## 12. Implementation Order

1. Update `types.ts` — `FleetStatus.mode`, `FleetInstance.index?`/`profile?`, `ServerConfig.deploymentMode`, `ProfilesConfig`
2. Update `validate.ts` — dual-mode `validateInstanceId`; update `fastify.d.ts`
3. Wrap Docker + Monitor + Tailscale logic into `DockerBackend`; extract `getDirectorySize` as shared utility; remove `app.monitor` decorator
4. Implement `ProfileBackend` — process management, health polling, crash recovery, logs, exec, token, config, startup recovery
5. Update `index.ts` — backend factory, `app.deploymentMode` decorator
6. Adapt routes — `fleet.ts`, `instances.ts`, `config.ts`, `logs.ts`
7. Add `routes/profiles.ts`
8. Update web UI — fleet overview, Add Profile dialog, instance panel labels, API client
9. Write tests
10. Update `server.config.example.json` with both mode examples; update README
