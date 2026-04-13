import { execFile } from 'node:child_process';
import { existsSync, createReadStream, readFileSync, readdirSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
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

  async start(_id: string): Promise<void> {
    throw new Error('Hermes profile lifecycle is managed by the Hermes runtime, not this backend');
  }

  async stop(_id: string): Promise<void> {
    throw new Error('Hermes profile lifecycle is managed by the Hermes runtime, not this backend');
  }

  async restart(_id: string): Promise<void> {
    throw new Error('Hermes profile lifecycle is managed by the Hermes runtime, not this backend');
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
    if (existsSync(homeDir)) {
      throw new Error(`Profile "${name}" already exists`);
    }

    await mkdir(homeDir, { recursive: true });
    await this.ensureHermesProfileScaffold(homeDir, opts.config);

    const instance = await this.buildInstance(name);
    await this.refresh();
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    rmSync(this.getProfileHome(id), { recursive: true, force: true });
    await this.refresh();
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
    if (!existsSync(currentHome)) {
      throw new Error(`Profile "${id}" not found`);
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
          return rest.join('=').trim();
        }
      }
    }

    const config = await this.readInstanceConfig(id) as HermesProfileConfig;
    const token = config.gateway?.auth?.token;
    return token ?? 'hidden';
  }

  async readInstanceConfig(id: string): Promise<object> {
    const configPath = join(this.ensureProfileHome(id), 'config.yaml');
    return (yaml.parse(readFileSync(configPath, 'utf-8')) ?? {}) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const configPath = join(this.ensureProfileHome(id), 'config.yaml');
    writeFileSync(configPath, yaml.stringify(config));
  }

  private getProfileHome(name: string): string {
    return join(this.cfg.baseHomeDir, name);
  }

  private getProfileLogPath(name: string): string {
    return join(this.getProfileHome(name), 'logs', 'gateway.log');
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
    const pidPath = join(homeDir, 'gateway.pid');
    let pid: number | undefined;
    let status: FleetInstance['status'] = 'stopped';

    if (existsSync(pidPath)) {
      const rawPid = readFileSync(pidPath, 'utf-8').trim();
      const parsedPid = Number.parseInt(rawPid, 10);
      if (Number.isFinite(parsedPid) && parsedPid > 0) {
        pid = parsedPid;
        try {
          process.kill(parsedPid, 0);
          status = 'running';
        } catch {
          status = 'stopped';
        }
      }
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
      health: 'none',
      image: this.cfg.binary,
      profile: name,
      pid,
      runtimeCapabilities: HERMES_PROFILE_RUNTIME_CAPABILITIES,
    };
  }
}
