// packages/server/src/services/profile-backend.ts
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, createReadStream, watch } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import { getDirectorySize } from './dir-utils.js';
import { FleetConfigService } from './fleet-config.js';
import type { FleetInstance, FleetStatus, ProfilesConfig } from '../types.js';

const execFileAsync = promisify(execFile);
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

interface ProfileEntry {
  name: string;
  port: number;
  pid: number | null;
  configPath: string;
  stateDir: string;
}

interface ProfileRegistry {
  profiles: Record<string, ProfileEntry>;
  nextPort: number;
}

export class ProfileBackend implements DeploymentBackend {
  private registry: ProfileRegistry = { profiles: {}, nextPort: 0 };
  private processStartTimes = new Map<string, number>();
  private instanceStatus = new Map<string, FleetInstance['status']>();
  private locks = new Map<string, boolean>();
  private cache: FleetStatus | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private binaryPath = '';

  constructor(
    private fleetDir: string,
    private cfg: ProfilesConfig,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    // Resolve binary path
    try {
      const { stdout } = await execFileAsync('which', [this.cfg.openclawBinary]);
      this.binaryPath = stdout.trim();
    } catch {
      // On some systems (e.g., macOS with different PATH), try direct
      this.binaryPath = this.cfg.openclawBinary;
    }

    // Load registry
    this.registry = this.loadRegistry();
    this.registry.nextPort = this.registry.nextPort || this.cfg.basePort;

    // Validate PIDs (stale PID cleanup)
    for (const entry of Object.values(this.registry.profiles)) {
      if (entry.pid !== null) {
        const alive = await this.isPidAlive(entry.pid, entry.name);
        if (!alive) {
          entry.pid = null;
          if (this.cfg.autoRestart) {
            this.log?.info({ profile: entry.name }, 'Dead PID found on startup, will restart');
            void this.start(entry.name).catch((err) => {
              this.log?.error({ err, profile: entry.name }, 'Auto-restart on startup failed');
            });
          }
        }
      }
    }
    this.saveRegistry();

    // Initial status build + start polling
    await this.refresh();
    this.pollInterval = setInterval(() => { void this.refresh(); }, 5000);
  }

  async shutdown(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    // Leave processes running on server shutdown (re-adopted on next startup)
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const instances: FleetInstance[] = await Promise.all(
      Object.values(this.registry.profiles).map(async (entry) => this.buildInstance(entry)),
    );

    const status: FleetStatus = {
      mode: 'profiles',
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };
    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);
    try {
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);

      const logDir = join(this.fleetDir, 'logs');
      await mkdir(logDir, { recursive: true });
      const logFile = join(logDir, `${id}.log`);

      // Append mode so we don't lose history
      const { createWriteStream } = await import('node:fs');
      const logStream = createWriteStream(logFile, { flags: 'a' });

      const child = spawn(
        this.binaryPath,
        ['--profile', id, 'gateway', '--port', String(entry.port)],
        { stdio: ['ignore', 'pipe', 'pipe'], detached: false },
      );

      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      entry.pid = child.pid ?? null;
      this.processStartTimes.set(id, Date.now());
      this.instanceStatus.set(id, 'running');
      this.saveRegistry();

      if (this.cfg.autoRestart) {
        let startTime = Date.now();
        child.on('exit', (code, signal) => {
          this.log?.warn({ profile: id, code, signal }, 'Profile process exited');
          entry.pid = null;
          this.instanceStatus.set(id, 'stopped');
          this.saveRegistry();

          setTimeout(async () => {
            const timeSinceStart = Date.now() - startTime;
            if (timeSinceStart < 5000) {
              this.log?.error({ profile: id }, 'Process re-exited within 5s — marking unhealthy');
              this.instanceStatus.set(id, 'unhealthy');
              return;
            }
            startTime = Date.now();
            try {
              await this.start(id);
            } catch (err) {
              this.log?.error({ err, profile: id }, 'Auto-restart failed');
              this.instanceStatus.set(id, 'unhealthy');
            }
          }, 2000);
        });
      }
    } finally {
      this.locks.set(id, false);
    }
  }

  async stop(id: string): Promise<void> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);
    try {
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);
      if (entry.pid === null) return;

      await this.killProcess(entry.pid);
      entry.pid = null;
      this.instanceStatus.set(id, 'stopped');
      this.saveRegistry();
    } finally {
      this.locks.set(id, false);
    }
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await this.start(id);
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const name = opts.name ?? '';
    if (!PROFILE_NAME_RE.test(name)) {
      throw new Error(`Invalid profile name: "${name}". Must match /^[a-z0-9][a-z0-9-]{0,62}$/`);
    }
    if (this.registry.profiles[name]) {
      throw new Error(`Profile "${name}" already exists`);
    }

    // Port assignment
    let port = opts.port ?? this.registry.nextPort;
    await this.probePort(port);

    // Paths
    const configDir = join(this.cfg.configBaseDir, name);
    const configPath = join(configDir, 'openclaw.json');
    const stateDir = join(this.cfg.stateBaseDir, name);

    // Run setup
    await execFileAsync(this.binaryPath, ['--profile', name, 'setup'], {
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: stateDir,
      },
    });

    // Write custom config if provided
    if (opts.config) {
      await mkdir(configDir, { recursive: true });
      const tmpPath = `${configPath}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(opts.config, null, 2) + '\n', 'utf-8');
      renameSync(tmpPath, configPath);
    }

    // Register
    const entry: ProfileEntry = { name, port, pid: null, configPath, stateDir };
    this.registry.profiles[name] = entry;
    if (opts.port === undefined) {
      this.registry.nextPort = port + this.cfg.portStep;
    }
    this.saveRegistry();

    // Start
    await this.start(name);
    await this.refresh();

    const instance = this.cache?.instances.find((i) => i.id === name);
    if (!instance) throw new Error(`Instance "${name}" not found after creation`);
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    await this.stop(id).catch(() => {});
    delete this.registry.profiles[id];
    this.instanceStatus.delete(id);
    this.processStartTimes.delete(id);
    this.saveRegistry();
    await this.refresh();
  }

  async scaleFleet(_count: number, _fleetDir: string): Promise<FleetStatus> {
    throw new Error('scaleFleet not supported in profile mode — use createInstance/removeInstance');
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    const logFile = join(this.fleetDir, 'logs', `${id}.log`);
    let stopped = false;
    let watcher: ReturnType<typeof watch> | null = null;
    let position = 0;

    const readNew = () => {
      if (stopped) return;
      try {
        const stream = createReadStream(logFile, { start: position, encoding: 'utf-8' });
        let buf = '';
        stream.on('data', (chunk: string) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) onData(line.trim());
          }
        });
        stream.on('end', () => {
          position += Buffer.byteLength(buf, 'utf-8');
        });
        stream.on('error', () => {});
      } catch {
        // file may not exist yet
      }
    };

    // Read existing content first
    readNew();

    if (existsSync(logFile)) {
      watcher = watch(logFile, () => readNew());
    }

    return {
      stop: () => {
        stopped = true;
        watcher?.close();
      },
    };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const handles = Object.keys(this.registry.profiles).map((name) =>
      this.streamLogs(name, (line) => onData(name, line)),
    );
    return { stop: () => { for (const h of handles) h.stop(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const { stdout } = await execFileAsync(this.binaryPath, ['--profile', id, ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const raw = readFileSync(entry.configPath, 'utf-8');
    const cfg = JSON.parse(raw) as { gateway?: { auth?: { token?: string } } };
    const token = cfg?.gateway?.auth?.token;
    if (!token) throw new Error(`Token not found in config for profile "${id}"`);
    return token;
  }

  async readInstanceConfig(id: string): Promise<object> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    return JSON.parse(readFileSync(entry.configPath, 'utf-8')) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    const tmpPath = `${entry.configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, entry.configPath);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async buildInstance(entry: ProfileEntry): Promise<FleetInstance> {
    // Health check
    let health: FleetInstance['health'] = 'none';
    let status: FleetInstance['status'] = this.instanceStatus.get(entry.name) ?? 'stopped';

    if (entry.pid !== null) {
      try {
        const res = await fetch(`http://127.0.0.1:${entry.port}/healthz`);
        health = res.ok ? 'healthy' : 'unhealthy';
        status = res.ok ? 'running' : 'unhealthy';
      } catch {
        // healthz unreachable — check PID
        const alive = await this.isPidAlive(entry.pid, entry.name);
        status = alive ? 'running' : 'stopped';
        if (!alive) {
          entry.pid = null;
          this.saveRegistry();
        }
      }
    }

    // Stats
    const { cpu, memUsed, memLimit } = await this.getProcessStats(entry.pid);
    const startTime = this.processStartTimes.get(entry.name) ?? 0;
    const uptime = status === 'running' && startTime > 0 ? Math.floor((Date.now() - startTime) / 1000) : 0;

    // Disk
    const configDir = dirname(entry.configPath);
    const [configSize, stateSize] = await Promise.all([
      getDirectorySize(configDir),
      getDirectorySize(entry.stateDir),
    ]);

    return {
      id: entry.name,
      profile: entry.name,
      pid: entry.pid ?? undefined,
      status,
      port: entry.port,
      token: FleetConfigService.maskToken(''),  // masked until revealed
      uptime,
      cpu,
      memory: { used: memUsed, limit: memLimit },
      disk: { config: configSize, workspace: stateSize },
      health,
      image: this.binaryPath,
    };
  }

  private async getProcessStats(pid: number | null): Promise<{ cpu: number; memUsed: number; memLimit: number }> {
    if (pid === null) return { cpu: 0, memUsed: 0, memLimit: 0 };
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=,rss=']);
      const [cpuStr, rssStr] = stdout.trim().split(/\s+/);
      return {
        cpu: parseFloat(cpuStr ?? '0') || 0,
        memUsed: parseInt(rssStr ?? '0', 10) * 1024, // KB to bytes
        memLimit: 0, // no hard limit in native mode
      };
    } catch {
      return { cpu: 0, memUsed: 0, memLimit: 0 };
    }
  }

  private async isPidAlive(pid: number, profileName: string): Promise<boolean> {
    try {
      process.kill(pid, 0);
      // Verify cmdline contains our profile
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command=']).catch(() => ({ stdout: '' }));
      return stdout.includes('openclaw') && stdout.includes(profileName);
    } catch {
      return false;
    }
  }

  private async killProcess(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    await new Promise<void>((resolve) => {
      const deadline = setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch {}
        resolve();
      }, this.cfg.stopTimeoutMs);
      const check = setInterval(() => {
        try {
          process.kill(pid, 0);
        } catch {
          clearTimeout(deadline);
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  private async probePort(port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.listen(port, () => {
        server.close(() => resolve());
      });
      server.on('error', () => {
        reject(new Error(`Port ${port} is already in use`));
      });
    });
  }

  private loadRegistry(): ProfileRegistry {
    const path = join(this.fleetDir, 'profiles.json');
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ProfileRegistry;
    } catch {
      return { profiles: {}, nextPort: this.cfg.basePort };
    }
  }

  private saveRegistry(): void {
    const path = join(this.fleetDir, 'profiles.json');
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.registry, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, path);
  }
}
