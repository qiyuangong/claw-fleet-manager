// packages/server/src/services/profile-backend.ts
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync, createReadStream, watch, openSync, closeSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import { upsertCachedInstance } from './backend.js';
import { getDirectorySize } from './dir-utils.js';
import { FleetConfigService } from './fleet-config.js';
import { getManagedProfileNameError, isValidManagedProfileName } from '../profile-names.js';
import type { FleetInstance, FleetStatus, ProfilesConfig } from '../types.js';
import { OPENCLAW_RUNTIME_CAPABILITIES } from './runtime-capabilities.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_GITIGNORE = `node_modules/
dist/
.turbo/
*.tsbuildinfo
server.config.json
certs/
.superpowers/
.env.local
.worktrees/
`;
const WORKSPACE_CLAUDE_MD = `# CLAUDE.md

Profile-local workspace for OpenClaw profile mode.
`;
const WORKSPACE_MEMORY_MD = `# MEMORY.md

## Notes

- Add profile-specific working notes here.
`;

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

type ProfileConfig = {
  gateway?: {
    auth?: {
      mode?: string;
      token?: string;
      password?: string;
    };
  };
  agents?: {
    defaults?: {
      workspace?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export class ProfileBackend implements DeploymentBackend {
  private registry: ProfileRegistry = { profiles: {}, nextPort: 0 };
  private processStartTimes = new Map<string, number>();
  private instanceStatus = new Map<string, FleetInstance['status']>();
  private locks = new Map<string, boolean>();
  private stopping = new Set<string>();
  private cache: FleetStatus | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private binaryPath = '';

  constructor(
    private fleetDir: string,
    private cfg: ProfilesConfig,
    private baseDir?: string,
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
      await this.ensureWorkspaceInitialized(entry).catch((err) => {
        this.log?.warn({ err, profile: entry.name }, 'Failed to align profile workspace files');
      });
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
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };
    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      this.stopping.delete(id);
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);

      const adoption = await this.detectHealthyGatewayOnPort(entry);
      if (adoption.adopted) {
        entry.pid = adoption.pid;
        this.processStartTimes.set(id, this.processStartTimes.get(id) ?? Date.now());
        this.instanceStatus.set(id, 'running');
        this.saveRegistry();
        this.log?.info({ profile: id, port: entry.port, pid: adoption.pid ?? null }, 'Adopted already-running profile gateway');
        return;
      }

      await this.probePort(entry.port);

      const logDir = join(this.fleetDir, 'logs');
      await mkdir(logDir, { recursive: true });
      const logFile = join(logDir, `${id}.log`);
      const logFd = openSync(logFile, 'a');
      let child;
      try {
        child = spawn(
          this.binaryPath,
          ['--profile', id, 'gateway', '--port', String(entry.port)],
          {
            stdio: ['ignore', logFd, logFd],
            detached: true,
            env: this.profileEnv(entry),
          },
        );
      } finally {
        try {
          closeSync(logFd);
        } catch {}
      }
      child.unref();

      entry.pid = child.pid ?? null;
      this.processStartTimes.set(id, Date.now());
      this.instanceStatus.set(id, 'running');
      this.saveRegistry();

      if (this.cfg.autoRestart) {
        let startTime = Date.now();
        child.on('exit', (code, signal) => {
          const intentionalStop = this.stopping.has(id);
          this.log?.warn({ profile: id, code, signal }, 'Profile process exited');
          entry.pid = null;
          this.instanceStatus.set(id, 'stopped');
          this.saveRegistry();

          if (intentionalStop) {
            this.stopping.delete(id);
            return;
          }

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
    });
  }

  async stop(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      const entry = this.registry.profiles[id];
      if (!entry) throw new Error(`Profile "${id}" not found`);
      if (entry.pid === null) return;

      this.stopping.add(id);
      await this.killProcess(entry.pid);
      entry.pid = null;
      this.instanceStatus.set(id, 'stopped');
      this.saveRegistry();
    });
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await this.start(id);
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const name = opts.name ?? '';
    if (!isValidManagedProfileName(name)) {
      throw new Error(getManagedProfileNameError(name));
    }
    if (this.registry.profiles[name]) {
      throw new Error(`Profile "${name}" already exists`);
    }

    // Port assignment
    let port = opts.port ?? this.registry.nextPort;
    await this.probePort(port);

    // Paths
    const stateDir = this.baseDir ? join(this.baseDir, name) : join(this.cfg.stateBaseDir, name);
    const configDir = this.baseDir ? stateDir : join(this.cfg.configBaseDir, name);
    const configPath = join(configDir, 'openclaw.json');

    // Run setup
    await execFileAsync(this.binaryPath, ['--profile', name, 'setup'], {
      env: this.profileEnv({ configPath, stateDir }),
    });

    await mkdir(configDir, { recursive: true });
    const rawConfig = readFileSync(configPath, 'utf-8');
    const nextConfig = JSON.parse(rawConfig) as ProfileConfig;
    nextConfig.agents ??= {};
    nextConfig.agents.defaults ??= {};
    const workspaceDir = join(stateDir, 'workspace');

    if (opts.config) {
      Object.assign(nextConfig, opts.config);
    }
    nextConfig.agents.defaults.workspace = workspaceDir;

    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(nextConfig, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
    await mkdir(workspaceDir, { recursive: true });
    this.seedWorkspaceFiles(workspaceDir);

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

  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);

    let lockId = id;
    const entry = this.registry.profiles[id];
    try {
      if (!entry) throw new Error(`Profile "${id}" not found`);
      if (id === nextName) {
        throw new Error('Cannot rename a profile to the same name');
      }
      if (!isValidManagedProfileName(nextName)) {
        throw new Error(getManagedProfileNameError(nextName));
      }
      if (this.registry.profiles[nextName]) {
        throw new Error(`Profile "${nextName}" already exists`);
      }

      if (entry.pid !== null) {
        throw new Error(`Profile "${id}" must be stopped before it can be renamed`);
      }

      const oldStateDir = entry.stateDir;
      const oldConfigDir = dirname(entry.configPath);
      const oldLogFile = join(this.fleetDir, 'logs', `${id}.log`);
      const nextLogFile = join(this.fleetDir, 'logs', `${nextName}.log`);
      const nextStateDir = this.baseDir ? join(this.baseDir, nextName) : join(this.cfg.stateBaseDir, nextName);
      const nextConfigDir = this.baseDir ? nextStateDir : join(this.cfg.configBaseDir, nextName);
      const nextConfigPath = join(nextConfigDir, 'openclaw.json');
      const nextEntry: ProfileEntry = {
        ...entry,
        name: nextName,
        stateDir: nextStateDir,
        configPath: nextConfigPath,
      };

      const rollbacks: Array<() => void> = [];
      try {
        renameSync(oldStateDir, nextStateDir);
        rollbacks.push(() => renameSync(nextStateDir, oldStateDir));

        if (oldConfigDir !== oldStateDir) {
          renameSync(oldConfigDir, nextConfigDir);
          rollbacks.push(() => renameSync(nextConfigDir, oldConfigDir));
        }

        this.rewriteWorkspacePath(nextConfigPath, join(nextStateDir, 'workspace'));
        rollbacks.push(() => this.rewriteWorkspacePath(nextConfigPath, join(oldStateDir, 'workspace')));

        delete this.registry.profiles[id];
        this.registry.profiles[nextName] = nextEntry;
        this.renameInstanceState(id, nextName);
        lockId = nextName;
        rollbacks.push(() => {
          delete this.registry.profiles[nextName];
          this.registry.profiles[id] = entry;
          this.renameInstanceState(nextName, id);
          lockId = id;
          this.saveRegistry();
        });
        this.saveRegistry();

        if (existsSync(oldLogFile)) {
          renameSync(oldLogFile, nextLogFile);
          rollbacks.push(() => { if (existsSync(nextLogFile)) renameSync(nextLogFile, oldLogFile); });
        }
      } catch (error) {
        for (const fn of rollbacks.reverse()) {
          try { fn(); } catch (rollbackError) {
            this.log?.error({ err: rollbackError, profile: id, nextName }, 'Failed to roll back profile rename');
          }
        }
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to rename profile "${id}" to "${nextName}": ${cause}`);
      }

      return await this.resolveRenamedProfile(id, nextEntry);
    } finally {
      this.locks.set(lockId, false);
    }
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
        let bytesRead = 0;
        stream.on('data', (chunk: string | Buffer) => {
          const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
          bytesRead += Buffer.byteLength(chunkStr, 'utf-8');
          buf += chunkStr;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.trim()) onData(line.trim());
          }
        });
        stream.on('end', () => {
          position += bytesRead;
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
    const commandArgs = this.requiresGatewayOverride(args) ? this.gatewayCommandArgs(entry, args) : args;
    const { stdout } = await execFileAsync(this.binaryPath, commandArgs, {
      env: this.profileEnv(entry),
    });
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

  getInstanceDir(id: string): { stateDir: string; configPath: string } {
    const entry = this.registry.profiles[id];
    if (!entry) throw new Error(`Profile "${id}" not found`);
    return { stateDir: entry.stateDir, configPath: entry.configPath };
  }

  async createInstanceFromMigration(opts: {
    name: string;
    workspaceDir: string;
    configDir: string;
    token: string;
    port?: number;
  }): Promise<FleetInstance> {
    if (this.registry.profiles[opts.name]) {
      throw new Error(`Profile "${opts.name}" already exists`);
    }

    const port = opts.port ?? this.registry.nextPort;
    await this.probePort(port);

    const configPath = join(opts.configDir, 'openclaw.json');
    const stateDir = dirname(opts.workspaceDir);

    const profileConfig = {
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: opts.token },
      },
      agents: {
        defaults: { workspace: opts.workspaceDir },
      },
    };

    await mkdir(opts.configDir, { recursive: true });
    await mkdir(opts.workspaceDir, { recursive: true });
    this.seedWorkspaceFiles(opts.workspaceDir);

    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(profileConfig, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);

    const entry: ProfileEntry = { name: opts.name, port, pid: null, configPath, stateDir };
    this.registry.profiles[opts.name] = entry;
    if (opts.port === undefined) {
      this.registry.nextPort = port + this.cfg.portStep;
    }
    this.saveRegistry();

    await this.start(opts.name);
    await this.refresh();

    const instance = this.cache?.instances.find((item) => item.id === opts.name);
    if (!instance) throw new Error(`Instance "${opts.name}" not found after migration`);
    return instance;
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
      runtime: 'openclaw',
      mode: 'profile',
      runtimeCapabilities: OPENCLAW_RUNTIME_CAPABILITIES,
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

  private async resolveRenamedProfile(previousId: string, entry: ProfileEntry): Promise<FleetInstance> {
    try {
      const status = await this.refresh();
      const renamed = status.instances.find((instance) => instance.id === entry.name);
      if (renamed) {
        return renamed;
      }
      this.log?.warn({ profile: previousId, renamed: entry.name }, 'Renamed profile missing from refresh; using fallback instance');
    } catch (error) {
      this.log?.warn({ err: error, profile: previousId, renamed: entry.name }, 'Failed to refresh renamed profile; using fallback instance');
    }

    const fallback = await this.buildInstance(entry);
    this.cache = upsertCachedInstance(this.cache, previousId, fallback);
    return fallback;
  }

  private profileEnv(entry: Pick<ProfileEntry, 'configPath' | 'stateDir'>): NodeJS.ProcessEnv {
    return {
      ...process.env,
      OPENCLAW_CONFIG_PATH: entry.configPath,
      OPENCLAW_STATE_DIR: entry.stateDir,
    };
  }

  private gatewayCommandArgs(entry: Pick<ProfileEntry, 'port' | 'configPath'>, args: string[]): string[] {
    const commandArgs = [...args, '--url', `ws://127.0.0.1:${entry.port}`];
    const auth = this.readGatewayAuth(entry);

    if (auth.mode === 'token' && auth.token) {
      commandArgs.push('--token', auth.token);
    } else if (auth.mode === 'password' && auth.password) {
      commandArgs.push('--password', auth.password);
    }

    return commandArgs;
  }

  private requiresGatewayOverride(args: string[]): boolean {
    return args[0] === 'devices';
  }

  private readGatewayAuth(entry: Pick<ProfileEntry, 'configPath'>): { mode?: string; token?: string; password?: string } {
    const raw = readFileSync(entry.configPath, 'utf-8');
    const config = JSON.parse(raw) as ProfileConfig;
    return {
      mode: config.gateway?.auth?.mode,
      token: config.gateway?.auth?.token,
      password: config.gateway?.auth?.password,
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
    const childPids = await this.listDescendantPids(pid);

    for (const childPid of childPids) {
      try {
        process.kill(childPid, 'SIGTERM');
      } catch {}
    }

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
          for (const childPid of childPids) {
            try { process.kill(childPid, 'SIGKILL'); } catch {}
          }
          clearTimeout(deadline);
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  private async listDescendantPids(pid: number): Promise<number[]> {
    const seen = new Set<number>();
    const queue = [pid];
    const result: number[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      try {
        const { stdout } = await execFileAsync('pgrep', ['-P', String(current)]);
        const children = stdout
          .split('\n')
          .map((value) => parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && !seen.has(value));
        for (const child of children) {
          seen.add(child);
          result.push(child);
          queue.push(child);
        }
      } catch {
        // No children for this process.
      }
    }

    return result.reverse();
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

  private async detectHealthyGatewayOnPort(entry: Pick<ProfileEntry, 'port'>): Promise<{ adopted: boolean; pid: number | null }> {
    try {
      const res = await fetch(`http://127.0.0.1:${entry.port}/healthz`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) {
        return { adopted: false, pid: null };
      }
    } catch {
      return { adopted: false, pid: null };
    }

    const pid = await this.getListeningPid(entry.port);
    return { adopted: true, pid };
  }

  private async getListeningPid(port: number): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
      const pid = parseInt(stdout.split('\n')[0]?.trim() ?? '', 10);
      return Number.isFinite(pid) ? pid : null;
    } catch {
      return null;
    }
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

  private async ensureWorkspaceInitialized(entry: Pick<ProfileEntry, 'name' | 'configPath' | 'stateDir'>): Promise<void> {
    const workspaceDir = join(entry.stateDir, 'workspace');
    await mkdir(workspaceDir, { recursive: true });
    this.seedWorkspaceFiles(workspaceDir);
    const updated = this.rewriteWorkspacePath(entry.configPath, workspaceDir);
    if (updated) {
      this.log?.info({ profile: entry.name, workspaceDir }, 'Migrated profile workspace path in config');
    }
  }

  private seedWorkspaceFiles(workspaceDir: string): void {
    const seeds: Array<[string, string]> = [
      ['.gitignore', WORKSPACE_GITIGNORE],
      ['CLAUDE.md', WORKSPACE_CLAUDE_MD],
      ['MEMORY.md', WORKSPACE_MEMORY_MD],
    ];

    for (const [name, content] of seeds) {
      const path = join(workspaceDir, name);
      if (!existsSync(path)) {
        writeFileSync(path, content, 'utf-8');
      }
    }
  }

  private rewriteWorkspacePath(configPath: string, workspaceDir: string): boolean {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as ProfileConfig;
    config.agents ??= {};
    config.agents.defaults ??= {};
    if (config.agents.defaults.workspace === workspaceDir) {
      return false;
    }
    config.agents.defaults.workspace = workspaceDir;
    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, configPath);
    return true;
  }

  private renameInstanceState(oldId: string, nextName: string): void {
    this.moveMapValue(this.processStartTimes, oldId, nextName);
    this.moveMapValue(this.instanceStatus, oldId, nextName);
    this.moveMapValue(this.locks, oldId, nextName);
    if (this.stopping.delete(oldId)) {
      this.stopping.add(nextName);
    }
  }

  private moveMapValue<T>(map: Map<string, T>, from: string, to: string): void {
    if (!map.has(from)) return;
    const value = map.get(from) as T;
    map.delete(from);
    map.set(to, value);
  }

  private async withInstanceLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.locks.get(id)) throw new Error(`Instance "${id}" is locked`);
    this.locks.set(id, true);
    try {
      return await fn();
    } finally {
      this.locks.set(id, false);
    }
  }
}
