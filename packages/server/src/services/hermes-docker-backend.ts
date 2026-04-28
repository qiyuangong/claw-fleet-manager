import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as yaml from 'yaml';
import { LockManager } from './backend.js';
import type { DeploymentBackend, CreateInstanceOpts, LogHandle } from './backend.js';
import type { DockerService } from './docker.js';
import { getDirectorySize } from './dir-utils.js';
import type { FleetInstance, FleetStatus, HermesDockerConfig, RuntimeCapabilities } from '../types.js';
import { MANAGED_INSTANCE_ID_RE } from '../validate.js';

const execFileAsync = promisify(execFile);

const HERMES_DOCKER_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
};

export function getHermesDockerFleetRoot(baseDir: string): string {
  return join(baseDir, '.claw-fleet', 'hermes');
}

export class HermesDockerBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private locks = new LockManager();

  constructor(
    private docker: DockerService,
    private cfg: HermesDockerConfig,
    private baseDir: string | (() => string),
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.resolveBaseDir(), { recursive: true });
    await this.refresh();
    this.interval = setInterval(() => {
      void this.refresh();
    }, 5000);
  }

  async shutdown(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    await mkdir(this.resolveBaseDir(), { recursive: true });
    const containers = (await this.docker.listFleetContainers())
      .filter((container) => container.runtime === 'hermes');
    const instances = await Promise.all(
      containers.map((container) => this.buildInstance(container)),
    );
    const status: FleetStatus = {
      instances: instances.sort((left, right) => left.id.localeCompare(right.id)),
      totalRunning: instances.filter((instance) => instance.status === 'running').length,
      updatedAt: Date.now(),
    };
    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.locks.withLock(id, async () => {
      this.ensureInstanceHome(id);
      await this.docker.startContainer(id);
    });
  }

  async stop(id: string): Promise<void> {
    await this.locks.withLock(id, async () => {
      this.ensureInstanceHome(id);
      await this.docker.stopContainer(id);
    });
  }

  async restart(id: string): Promise<void> {
    await this.locks.withLock(id, async () => {
      this.ensureInstanceHome(id);
      await this.docker.restartContainer(id);
    });
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    if (opts.runtime !== 'hermes') {
      throw new Error(`runtime "${opts.runtime}" is not supported by HermesDockerBackend`);
    }
    if (opts.kind !== 'docker') {
      throw new Error('HermesDockerBackend only supports docker mode');
    }

    const containers = await this.docker.listFleetContainers();
    const usedIndexes = containers
      .map((container) => container.index)
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    const index = nextAvailableIndex(usedIndexes);
    const name = opts.name?.trim() || `hermes-${index}`;

    if (!MANAGED_INSTANCE_ID_RE.test(name)) {
      throw new Error('name must be lowercase alphanumeric with hyphens');
    }
    if (containers.some((container) => container.name === name)) {
      throw new Error(`Instance "${name}" already exists`);
    }

    const homeDir = this.getInstanceHome(name);
    const workspaceDir = join(homeDir, 'workspace');
    await this.ensureHermesHomeScaffold(homeDir, opts.config);

    await this.docker.createManagedContainer({
      name,
      index,
      runtime: 'hermes',
      image: opts.image ?? this.cfg.image,
      gatewayPort: 0,
      token: '',
      timezone: 'UTC',
      configDir: homeDir,
      workspaceDir,
      cpuLimit: opts.cpuLimit ?? '1',
      memLimit: opts.memoryLimit ?? '1G',
      binds: [`${homeDir}:${this.cfg.mountPath}`],
      extraEnv: [
        `HERMES_HOME=${this.cfg.mountPath}`,
        ...Object.entries(this.cfg.env).map(([key, value]) => `${key}=${value}`),
      ],
      command: ['gateway', 'run'],
      exposedTcpPorts: [],
      healthcheck: null,
    });

    const status = await this.refresh();
    const instance = status.instances.find((item) => item.id === name);
    if (!instance) {
      throw new Error(`Instance "${name}" not found after creation`);
    }
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    await this.locks.withLock(id, async () => {
      try {
        await this.docker.removeContainer(id);
      } catch {
        // Best effort if container is already gone.
      }
      rmSync(this.getInstanceHome(id), { recursive: true, force: true });
      await this.refresh();
    });
  }

  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (id === nextName) {
      throw new Error('Cannot rename an instance to the same name');
    }
    if (!MANAGED_INSTANCE_ID_RE.test(nextName)) {
      throw new Error('name must be lowercase alphanumeric with hyphens');
    }

    return this.locks.withLocks([id, nextName], async () => {
      const containers = (await this.docker.listFleetContainers())
        .filter((container) => container.runtime === 'hermes');
      const source = containers.find((container) => container.name === id);
      if (!source) {
        throw new Error(`Instance "${id}" not found`);
      }
      if (containers.some((container) => container.name === nextName)) {
        throw new Error(`Instance "${nextName}" already exists`);
      }

      const inspection = await this.docker.inspectContainer(id).catch(() => ({
        status: source.state,
        health: 'none',
        image: this.cfg.image,
        uptime: 0,
      }));
      if (this.mapStatus(inspection.status) !== 'stopped') {
        throw new Error(`Instance "${id}" must be stopped before it can be renamed`);
      }

      const currentHome = this.getInstanceHome(id);
      const nextHome = this.getInstanceHome(nextName);
      renameSync(currentHome, nextHome);
      try {
        await this.docker.recreateStoppedManagedContainer({
          currentName: id,
          nextName,
          configDir: nextHome,
          workspaceDir: join(nextHome, 'workspace'),
          binds: [`${nextHome}:${this.cfg.mountPath}`],
        });
      } catch (error) {
        renameSync(nextHome, currentHome);
        throw error;
      }

      const status = await this.refresh();
      const instance = status.instances.find((item) => item.id === nextName);
      if (!instance) {
        throw new Error(`Instance "${nextName}" not found after rename`);
      }
      return instance;
    });
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    let logStream: import('node:stream').Readable | undefined;
    (async () => {
      logStream = await this.docker.getContainerLogs(id, { follow: true, tail: 100 }) as import('node:stream').Readable;
      logStream.on('data', (chunk: Buffer) => {
        for (const line of this.demuxDockerChunk(chunk)) {
          onData(line);
        }
      });
    })().catch(() => {});
    return { stop: () => logStream?.destroy() };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const streams: import('node:stream').Readable[] = [];
    (async () => {
      const containers = (await this.docker.listFleetContainers())
        .filter((container) => container.runtime === 'hermes');
      for (const container of containers) {
        try {
          const logStream = await this.docker.getContainerLogs(container.name, { follow: true, tail: 20 }) as import('node:stream').Readable;
          streams.push(logStream);
          logStream.on('data', (chunk: Buffer) => {
            for (const line of this.demuxDockerChunk(chunk)) {
              onData(container.name, line);
            }
          });
        } catch {
          // Best effort per container.
        }
      }
    })().catch(() => {});
    return { stop: () => { for (const stream of streams) stream.destroy(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', ['exec', id, 'hermes', ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const config = await this.readInstanceConfig(id) as { gateway?: { auth?: { token?: unknown } } };
    const token = config.gateway?.auth?.token;
    if (typeof token === 'string' && token.trim()) {
      return token.trim();
    }
    throw new Error(`Token not found for instance "${id}"`);
  }

  async readInstanceConfig(id: string): Promise<object> {
    return (yaml.parse(readFileSync(join(this.ensureInstanceHome(id), 'config.yaml'), 'utf-8')) ?? {}) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const configPath = join(this.ensureInstanceHome(id), 'config.yaml');
    const tmpPath = `${configPath}.tmp`;
    writeFileSync(tmpPath, yaml.stringify(config));
    renameSync(tmpPath, configPath);
  }

  private getInstanceHome(name: string): string {
    return join(this.resolveBaseDir(), name);
  }

  private resolveBaseDir(): string {
    return typeof this.baseDir === 'function' ? this.baseDir() : this.baseDir;
  }

  private ensureInstanceHome(name: string): string {
    const homeDir = this.getInstanceHome(name);
    mkdirSync(homeDir, { recursive: true });
    return homeDir;
  }

  private async ensureHermesHomeScaffold(homeDir: string, config?: object): Promise<void> {
    const workspaceDir = join(homeDir, 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    const configPath = join(homeDir, 'config.yaml');
    if (!readable(configPath) && config) {
      writeFileSync(configPath, yaml.stringify(config as Record<string, unknown>));
    }
  }

  private async buildInstance(container: { name: string; state: string; index?: number }): Promise<FleetInstance> {
    const homeDir = this.getInstanceHome(container.name);
    const [stats, inspection] = await Promise.all([
      this.docker.getContainerStats(container.name).catch(() => ({
        cpu: 0,
        memory: { used: 0, limit: 0 },
      })),
      this.docker.inspectContainer(container.name).catch(() => ({
        status: container.state,
        health: 'none',
        image: this.cfg.image,
        uptime: 0,
      })),
    ]);

    return {
      id: container.name,
      runtime: 'hermes',
      mode: 'docker',
      runtimeCapabilities: HERMES_DOCKER_RUNTIME_CAPABILITIES,
      index: container.index,
      status: this.mapStatus(inspection.status),
      port: 0,
      token: 'hidden',
      uptime: inspection.uptime,
      cpu: stats.cpu,
      memory: stats.memory,
      disk: {
        config: await getDirectorySize(homeDir),
        workspace: await getDirectorySize(join(homeDir, 'workspace')),
      },
      health: inspection.health === 'none' && inspection.status === 'running'
        ? 'healthy'
        : this.mapHealth(inspection.health),
      image: inspection.image,
    };
  }

  private mapStatus(status: string): FleetInstance['status'] {
    if (status === 'running') return 'running';
    if (status === 'restarting') return 'restarting';
    if (status === 'exited' || status === 'dead' || status === 'created') return 'stopped';
    if (status === 'unhealthy') return 'unhealthy';
    return 'unknown';
  }

  private mapHealth(health: string): FleetInstance['health'] {
    if (health === 'healthy') return 'healthy';
    if (health === 'unhealthy') return 'unhealthy';
    if (health === 'starting') return 'starting';
    return 'none';
  }

  private demuxDockerChunk(chunk: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset + 8 <= chunk.length) {
      const size = chunk.readUInt32BE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > chunk.length) break;
      const text = chunk.toString('utf-8', start, end).trim();
      if (text) lines.push(...text.split('\n').map((line) => line.trim()).filter(Boolean));
      offset = end;
    }
    if (lines.length === 0) {
      const fallback = chunk.toString('utf-8').trim();
      if (fallback) lines.push(...fallback.split('\n').map((line) => line.trim()).filter(Boolean));
    }
    return lines;
  }

}

function nextAvailableIndex(usedIndexes: number[]): number {
  let candidate = 1;
  for (const index of usedIndexes) {
    if (index === candidate) candidate += 1;
  }
  return candidate;
}

function readable(path: string): boolean {
  try {
    readFileSync(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}
