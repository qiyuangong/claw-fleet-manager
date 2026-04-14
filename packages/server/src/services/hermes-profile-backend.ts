import { execFile, spawn } from 'node:child_process';
import { closeSync, createReadStream, existsSync, openSync, readFileSync, readdirSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DeploymentBackend, CreateInstanceOpts, LogHandle } from './backend.js';
import { getDirectorySize } from './dir-utils.js';
import { getManagedProfileNameError, isValidManagedProfileName } from '../profile-names.js';
import type { FleetInstance, FleetStatus, HermesProfilesConfig, RuntimeCapabilities } from '../types.js';
import * as yaml from 'yaml';

const execFileAsync = promisify(execFile);

const HERMES_PROFILE_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
};

type HermesProfileConfig = Record<string, unknown> & {
  gateway?: {
    auth?: {
      token?: string;
      mode?: string;
      password?: string;
    };
    [key: string]: unknown;
  };
};

export class HermesProfileBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;
  private locks = new Map<string, boolean>();

  constructor(private cfg: HermesProfilesConfig) {}

  async initialize(): Promise<void> {
    await mkdir(this.cfg.baseHomeDir, { recursive: true });
    await this.refresh();
  }

  async shutdown(): Promise<void> {
    this.cache = this.cache ?? null;
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    await mkdir(this.cfg.baseHomeDir, { recursive: true });
    const instances = readdirSync(this.cfg.baseHomeDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidManagedProfileName(entry.name))
      .map((entry) => this.buildInstance(entry.name));

    const resolved = await Promise.all(instances);
    const status: FleetStatus = {
      instances: resolved.sort((left, right) => left.id.localeCompare(right.id)),
      totalRunning: resolved.filter((instance) => instance.status === 'running').length,
      updatedAt: Date.now(),
    };
    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.withLocks([id], async () => {
      const homeDir = this.ensureProfileHome(id);
      const pidPath = this.getProfilePidPath(id);
      const statePath = this.getProfileStatePath(id);

      const existingPid = await this.getValidatedPid(pidPath, homeDir);
      if (existingPid !== undefined) {
        await this.writeRuntimeState(statePath, 'running');
        return;
      }

      await this.ensureHermesProfileScaffold(homeDir);
      await this.writeRuntimeState(statePath, 'starting');

      const logPath = this.getProfileLogPath(id);
      const logFd = openSync(logPath, 'a');
      try {
        const child = spawn(this.cfg.binary, ['gateway', 'run'], {
          detached: true,
          stdio: ['ignore', logFd, logFd],
          env: {
            ...process.env,
            HERMES_HOME: homeDir,
          },
        });
        if (child.pid === undefined || child.pid === null) {
          throw new Error(`Failed to start Hermes gateway for profile "${id}"`);
        }
        child.unref();
        writeFileSync(pidPath, `${child.pid}\n`, 'utf-8');
        await this.awaitGatewayOwnership(homeDir, pidPath);
        await this.writeRuntimeState(statePath, 'running');
      } finally {
        closeSync(logFd);
      }
    });
  }

  async stop(id: string): Promise<void> {
    await this.withLocks([id], async () => {
      this.ensureProfileHome(id);
      const pidPath = this.getProfilePidPath(id);
      const statePath = this.getProfileStatePath(id);
      const pid = await this.getValidatedPid(pidPath, this.getProfileHome(id));
      if (pid === undefined) {
        await this.writeRuntimeState(statePath, 'stopped');
        return;
      }

      await this.writeRuntimeState(statePath, 'draining');
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // If SIGTERM fails, continue to cleanup below.
      }

      const deadline = Date.now() + this.cfg.stopTimeoutMs;
      while (Date.now() < deadline) {
        if (!(await this.isHermesGatewayProcess(pid, this.getProfileHome(id)))) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (await this.isHermesGatewayProcess(pid, this.getProfileHome(id))) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Best effort.
        }
      }

      rmSync(pidPath, { force: true });
      await this.writeRuntimeState(statePath, 'stopped');
    });
  }

  async restart(id: string): Promise<void> {
    await this.withLocks([id], async () => {
      await this.stopWithoutLock(id);
      await this.startWithoutLock(id);
    });
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    if (opts.runtime !== 'hermes') {
      throw new Error(`runtime "${opts.runtime}" is not supported by HermesProfileBackend`);
    }
    if (opts.kind !== 'profile') {
      throw new Error('HermesProfileBackend only supports profile mode');
    }

    const name = opts.name ?? '';
    if (!isValidManagedProfileName(name)) {
      throw new Error(getManagedProfileNameError(name));
    }

    const homeDir = this.getProfileHome(name);
    await mkdir(homeDir, { recursive: true });
    await this.ensureHermesProfileScaffold(homeDir, opts.config);

    const instance = await this.buildInstance(name);
    await this.refresh();
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    await this.withLocks([id], async () => {
      const homeDir = this.getProfileHome(id);
      if (existsSync(homeDir) && await this.isProfileRunning(id)) {
        await this.stopWithoutLock(id);
      }
      rmSync(homeDir, { recursive: true, force: true });
      await this.refresh();
    });
  }

  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (id === nextName) {
      throw new Error('Cannot rename an instance to the same name');
    }
    if (!isValidManagedProfileName(nextName)) {
      throw new Error(getManagedProfileNameError(nextName));
    }

    const currentHome = this.getProfileHome(id);
    const nextHome = this.getProfileHome(nextName);
    return await this.withLocks([id, nextName], async () => {
      if (!existsSync(currentHome)) {
        throw new Error(`Profile "${id}" not found`);
      }
      if (await this.isProfileRunning(id)) {
        throw new Error(`Profile "${id}" must be stopped before it can be renamed`);
      }
      if (existsSync(nextHome)) {
        throw new Error(`Profile "${nextName}" already exists`);
      }

      renameSync(currentHome, nextHome);
      await this.refresh();
      const renamed = this.cache?.instances.find((instance) => instance.id === nextName);
      if (!renamed) {
        throw new Error(`Instance "${nextName}" not found after rename`);
      }
      return renamed;
    });
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    const logFile = this.getProfileLogPath(id);
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
        // File may not exist yet.
      }
    };

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
    const handles = (this.cache?.instances ?? []).map((instance) =>
      this.streamLogs(instance.id, (line) => onData(instance.id, line)),
    );
    return {
      stop: () => {
        for (const handle of handles) handle.stop();
      },
    };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const homeDir = this.ensureProfileHome(id);
    const { stdout } = await execFileAsync(this.cfg.binary, args, {
      env: {
        ...process.env,
        HERMES_HOME: homeDir,
      },
    });
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const homeDir = this.ensureProfileHome(id);
    const envPath = join(homeDir, '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const [key, ...rest] = trimmed.split('=');
        if (key === 'HERMES_GATEWAY_TOKEN') {
          const token = rest.join('=').trim();
          if (token) {
            return token;
          }
        }
      }
    }

    const config = await this.readInstanceConfig(id) as HermesProfileConfig;
    const token = config.gateway?.auth?.token;
    if (typeof token === 'string' && token.trim()) {
      return token.trim();
    }
    throw new Error(`Token not found for profile "${id}"`);
  }

  async readInstanceConfig(id: string): Promise<object> {
    const configPath = join(this.ensureProfileHome(id), 'config.yaml');
    return (yaml.parse(readFileSync(configPath, 'utf-8')) ?? {}) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const configPath = join(this.ensureProfileHome(id), 'config.yaml');
    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, yaml.stringify(config));
    renameSync(tmpPath, configPath);
  }

  private getProfileHome(name: string): string {
    return join(this.cfg.baseHomeDir, name);
  }

  private getProfileLogPath(name: string): string {
    return join(this.getProfileHome(name), 'logs', 'gateway.log');
  }

  private getProfilePidPath(name: string): string {
    return join(this.getProfileHome(name), 'gateway.pid');
  }

  private getProfileStatePath(name: string): string {
    return join(this.getProfileHome(name), 'gateway_state.json');
  }

  private ensureProfileHome(id: string): string {
    const homeDir = this.getProfileHome(id);
    if (!existsSync(homeDir)) {
      throw new Error(`Profile "${id}" not found`);
    }
    return homeDir;
  }

  private async ensureHermesProfileScaffold(homeDir: string, config?: object): Promise<void> {
    const logsDir = join(homeDir, 'logs');
    await mkdir(logsDir, { recursive: true });

    const configPath = join(homeDir, 'config.yaml');
    if (!existsSync(configPath)) {
      const scaffold: HermesProfileConfig = {
        agent: {},
        gateway: {
          auth: {},
        },
      };
      const nextConfig = config ? { ...scaffold, ...(config as Record<string, unknown>) } : scaffold;
      writeFileSync(configPath, yaml.stringify(nextConfig));
    }

    const logPath = join(logsDir, 'gateway.log');
    if (!existsSync(logPath)) {
      writeFileSync(logPath, '', 'utf-8');
    }

    const statePath = join(homeDir, 'gateway_state.json');
    if (!existsSync(statePath)) {
      writeFileSync(statePath, JSON.stringify({ status: 'stopped' }, null, 2) + '\n', 'utf-8');
    }
  }

  private async buildInstance(name: string): Promise<FleetInstance> {
    const homeDir = this.getProfileHome(name);
    const pidPath = this.getProfilePidPath(name);
    const statePath = this.getProfileStatePath(name);
    const state = this.readRuntimeState(statePath);
    let pid: number | undefined;
    let status: FleetInstance['status'] = 'stopped';
    let health: FleetInstance['health'] = 'none';

    const livePid = await this.getValidatedPid(pidPath, homeDir);
    if (livePid !== undefined) {
      pid = livePid;
      status = 'running';
      health = 'healthy';
    }

    if (state) {
      switch (state.status) {
        case 'starting':
          if (pid !== undefined) {
            status = 'restarting';
            health = 'starting';
          } else {
            status = 'stopped';
            health = 'none';
          }
          break;
        case 'running':
          if (pid !== undefined) {
            status = 'running';
            health = 'healthy';
          } else {
            status = 'stopped';
            health = 'none';
          }
          break;
        case 'startup_failed':
          status = 'unhealthy';
          health = 'unhealthy';
          break;
        case 'draining':
          if (pid !== undefined) {
            status = 'restarting';
            health = 'starting';
          } else {
            status = 'stopped';
            health = 'none';
          }
          break;
        case 'stopped':
          if (status !== 'running') {
            status = 'stopped';
            health = 'none';
          }
          break;
        default:
          break;
      }
    }

    if (status === 'running' && health === 'none') {
      health = 'healthy';
    }

    const [configSize, workspaceSize] = await Promise.all([
      getDirectorySize(homeDir),
      getDirectorySize(join(homeDir, 'workspace')),
    ]);

    return {
      id: name,
      runtime: 'hermes',
      mode: 'profile',
      status,
      port: 0,
      token: 'hidden',
      uptime: 0,
      cpu: 0,
      memory: { used: 0, limit: 0 },
      disk: { config: configSize, workspace: workspaceSize },
      health,
      image: this.cfg.binary,
      profile: name,
      pid,
      runtimeCapabilities: HERMES_PROFILE_RUNTIME_CAPABILITIES,
    };
  }

  private readPid(pidPath: string): number | undefined {
    if (!existsSync(pidPath)) {
      return undefined;
    }
    const rawPid = readFileSync(pidPath, 'utf-8').trim();
    if (!rawPid) {
      return undefined;
    }

    const parsedPid = Number.parseInt(rawPid, 10);
    if (Number.isFinite(parsedPid) && parsedPid > 0) {
      return parsedPid;
    }

    try {
      const parsed = JSON.parse(rawPid) as { pid?: unknown };
      const jsonPid = typeof parsed.pid === 'number'
        ? parsed.pid
        : typeof parsed.pid === 'string'
          ? Number.parseInt(parsed.pid, 10)
          : Number.NaN;
      return Number.isFinite(jsonPid) && jsonPid > 0 ? jsonPid : undefined;
    } catch {
      return undefined;
    }
  }

  private async getValidatedPid(pidPath: string, expectedHome: string): Promise<number | undefined> {
    const pid = this.readPid(pidPath);
    if (pid === undefined) {
      return undefined;
    }
    return await this.isHermesGatewayProcess(pid, expectedHome) ? pid : undefined;
  }

  private async awaitGatewayOwnership(homeDir: string, pidPath: string): Promise<number | undefined> {
    const deadline = Date.now() + Math.min(this.cfg.stopTimeoutMs, 3000);
    while (Date.now() < deadline) {
      const pid = await this.getValidatedPid(pidPath, homeDir);
      if (pid !== undefined) {
        return pid;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
  }

  private async startWithoutLock(id: string): Promise<void> {
    const homeDir = this.ensureProfileHome(id);
    const pidPath = this.getProfilePidPath(id);
    const statePath = this.getProfileStatePath(id);

    const existingPid = await this.getValidatedPid(pidPath, homeDir);
    if (existingPid !== undefined) {
      await this.writeRuntimeState(statePath, 'running');
      return;
    }

    await this.ensureHermesProfileScaffold(homeDir);
    await this.writeRuntimeState(statePath, 'starting');

    const logPath = this.getProfileLogPath(id);
    const logFd = openSync(logPath, 'a');
    try {
      const child = spawn(this.cfg.binary, ['gateway', 'run'], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...process.env,
          HERMES_HOME: homeDir,
        },
      });
      if (child.pid === undefined || child.pid === null) {
        throw new Error(`Failed to start Hermes gateway for profile "${id}"`);
      }
      child.unref();
      writeFileSync(pidPath, `${child.pid}\n`, 'utf-8');
      await this.awaitGatewayOwnership(homeDir, pidPath);
      await this.writeRuntimeState(statePath, 'running');
    } finally {
      closeSync(logFd);
    }
  }

  private async stopWithoutLock(id: string): Promise<void> {
    this.ensureProfileHome(id);
    const pidPath = this.getProfilePidPath(id);
    const statePath = this.getProfileStatePath(id);
    const pid = await this.getValidatedPid(pidPath, this.getProfileHome(id));
    if (pid === undefined) {
      await this.writeRuntimeState(statePath, 'stopped');
      return;
    }

    await this.writeRuntimeState(statePath, 'draining');
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // If SIGTERM fails, continue to cleanup below.
    }

    const deadline = Date.now() + this.cfg.stopTimeoutMs;
    while (Date.now() < deadline) {
      if (!(await this.isHermesGatewayProcess(pid, this.getProfileHome(id)))) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (await this.isHermesGatewayProcess(pid, this.getProfileHome(id))) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Best effort.
      }
    }

    rmSync(pidPath, { force: true });
    await this.writeRuntimeState(statePath, 'stopped');
  }

  private readRuntimeState(statePath: string): { status?: string } | undefined {
    if (!existsSync(statePath)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(statePath, 'utf-8')) as { status?: string };
    } catch {
      return undefined;
    }
  }

  private async writeRuntimeState(statePath: string, status: string): Promise<void> {
    writeFileSync(statePath, JSON.stringify({ status }, null, 2) + '\n', 'utf-8');
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async isHermesGatewayProcess(pid: number, expectedHome: string): Promise<boolean> {
    if (!this.isPidAlive(pid)) {
      return false;
    }

    try {
      const { stdout } = await execFileAsync('ps', ['eww', '-p', String(pid), '-o', 'command=']);
      const command = stdout.trim().replace(/\s+/g, ' ');
      return /\bhermes\b.*\bgateway\b.*\brun\b/i.test(command)
        && command.includes(`HERMES_HOME=${expectedHome}`);
    } catch {
      return false;
    }
  }

  private async isProfileRunning(id: string): Promise<boolean> {
    const pid = await this.getValidatedPid(this.getProfilePidPath(id), this.getProfileHome(id));
    return pid !== undefined;
  }

  private async withLocks<T>(ids: string[], operation: () => Promise<T>): Promise<T> {
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      if (this.locks.get(id)) {
        throw new Error(`Instance "${id}" is locked`);
      }
    }

    for (const id of uniqueIds) {
      this.locks.set(id, true);
    }

    try {
      return await operation();
    } finally {
      for (const id of uniqueIds) {
        this.locks.set(id, false);
      }
    }
  }
}
