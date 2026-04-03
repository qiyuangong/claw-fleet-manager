// packages/server/src/services/docker-backend.ts
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import type { DockerService } from './docker.js';
import { FleetConfigService } from './fleet-config.js';
import { provisionDockerInstance } from './docker-instance-provisioning.js';
import type { TailscaleService } from './tailscale.js';
import { getDirectorySize } from './dir-utils.js';
import type { FleetInstance, FleetStatus } from '../types.js';

const execFileAsync = promisify(execFile);
export const BASE_GW_PORT = 18789;

export class DockerBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private docker: DockerService,
    private fleetConfig: FleetConfigService,
    private fleetDir: string,
    private tailscale: TailscaleService | null,
    private tailscaleHostname: string | null,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    if (this.tailscale) {
      const containers = await this.docker.listFleetContainers().catch(() => []);
      const portStep = this.fleetConfig.readFleetConfig().portStep;
      const instances = containers.map((c) => {
        const index = parseInt(c.name.replace('openclaw-', ''), 10);
        const gwPort = BASE_GW_PORT + (index - 1) * portStep;
        return { index, gwPort };
      });
      await this.tailscale.syncAll(instances);
    }
    void this.refresh();
    this.interval = setInterval(() => { void this.refresh(); }, 5000);
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
    const containers = await this.docker.listFleetContainers();
    const tokens = this.fleetConfig.readTokens();
    const config = this.fleetConfig.readFleetConfig();
    const configBase = this.fleetConfig.getConfigBase();
    const workspaceBase = this.fleetConfig.getWorkspaceBase();

    const instances: FleetInstance[] = await Promise.all(
      containers.map(async (container) => {
        const index = parseInt(container.name.replace('openclaw-', ''), 10);
        const [stats, inspection] = await Promise.all([
          this.docker.getContainerStats(container.name).catch(() => ({
            cpu: 0,
            memory: { used: 0, limit: 0 },
          })),
          this.docker.inspectContainer(container.name).catch(() => ({
            status: container.state,
            health: 'none',
            image: 'unknown',
            uptime: 0,
          })),
        ]);

        return {
          id: container.name,
          index,
          status: this.mapStatus(inspection.status),
          port: BASE_GW_PORT + (index - 1) * config.portStep,
          token: FleetConfigService.maskToken(tokens[index] ?? ''),
          tailscaleUrl: this.tailscale?.getUrl(index) ?? undefined,
          uptime: inspection.uptime,
          cpu: stats.cpu,
          memory: stats.memory,
          disk: {
            config: await getDirectorySize(join(configBase, String(index))),
            workspace: await getDirectorySize(join(workspaceBase, String(index))),
          },
          health: this.mapHealth(inspection.health),
          image: inspection.image,
        };
      }),
    );

    // Override disk from Docker volume usage (best effort)
    try {
      const diskUsage = await this.docker.getDiskUsage();
      for (const instance of instances) {
        for (const [name, size] of Object.entries(diskUsage)) {
          if (instance.index !== undefined) {
            if (name.includes(`instances/${instance.index}`) || name.includes(`config/${instance.index}`)) {
              instance.disk.config = size;
            }
            if (name.includes(`workspaces/${instance.index}`)) {
              instance.disk.workspace = size;
            }
          }
        }
      }
    } catch {
      // best effort
    }

    const status: FleetStatus = {
      mode: 'docker',
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };

    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.docker.startContainer(id);
  }

  async stop(id: string): Promise<void> {
    await this.docker.stopContainer(id);
  }

  async restart(id: string): Promise<void> {
    await this.docker.restartContainer(id);
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const containers = await this.docker.listFleetContainers();
    const newIndex = containers.length + 1;
    const expectedId = `openclaw-${newIndex}`;
    if (opts.name && opts.name !== expectedId) {
      throw new Error(`Docker mode requires sequential instance ids; expected "${expectedId}"`);
    }

    const config = this.fleetConfig.readFleetConfig();
    const vars = this.fleetConfig.readFleetEnvRaw();
    const tokens = this.fleetConfig.readTokens();
    const token = tokens[newIndex] ?? randomToken();
    this.fleetConfig.writeTokens({ ...tokens, [newIndex]: token });
    this.fleetConfig.ensureFleetDirectories();

    const portMap = this.tailscale?.allocatePorts([newIndex]) ?? new Map<number, number>();
    provisionDockerInstance({
      index: newIndex,
      portStep: config.portStep,
      configBase: config.configBase,
      workspaceBase: config.workspaceBase,
      vars,
      token,
      tailscaleConfig: this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
      configOverride: opts.config,
    });

    await this.docker.createManagedContainer({
      name: expectedId,
      image: config.openclawImage,
      gatewayPort: BASE_GW_PORT + (newIndex - 1) * config.portStep,
      token,
      timezone: config.tz,
      configDir: join(config.configBase, String(newIndex)),
      workspaceDir: join(config.workspaceBase, String(newIndex)),
      npmDir: config.enableNpmPackages ? join(config.configBase, String(newIndex), '.npm') : undefined,
      cpuLimit: config.cpuLimit,
      memLimit: config.memLimit,
    });
    this.writeFleetCount(newIndex, vars);

    if (this.tailscale) {
      const gwPort = BASE_GW_PORT + (newIndex - 1) * config.portStep;
      try {
        await this.tailscale.setup(newIndex, gwPort);
      } catch (err) {
        this.log?.error({ err, newIndex }, 'Tailscale setup failed for new instance');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((i) => i.index === newIndex);
    if (!instance) throw new Error(`Instance openclaw-${newIndex} not found after creation`);
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    const containers = await this.docker.listFleetContainers();
    if (containers.length === 0) return;

    const highestIndex = Math.max(...containers.map((c) => parseInt(c.name.replace('openclaw-', ''), 10)));
    const requestedIndex = parseInt(id.replace('openclaw-', ''), 10);
    if (requestedIndex !== highestIndex) {
      throw new Error(`Docker mode can only remove the highest-numbered instance (expected openclaw-${highestIndex})`);
    }

    await this.tailscale?.teardown(highestIndex);

    try {
      await this.docker.removeContainer(`openclaw-${highestIndex}`);
    } catch {
      // already removed
    }
    this.writeFleetCount(highestIndex - 1);
    await this.refresh();
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
    })().catch((err) => this.log?.error({ err, id }, 'streamLogs failed'));
    return { stop: () => logStream?.destroy() };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const streams: import('node:stream').Readable[] = [];
    (async () => {
      const containers = await this.docker.listFleetContainers();
      for (const container of containers) {
        try {
          const logStream = await this.docker.getContainerLogs(
            container.name,
            { follow: true, tail: 20 },
          ) as import('node:stream').Readable;
          streams.push(logStream);
          logStream.on('data', (chunk: Buffer) => {
            for (const line of this.demuxDockerChunk(chunk)) {
              onData(container.name, line);
            }
          });
        } catch {
          // best effort per container
        }
      }
    })().catch((err) => this.log?.error({ err }, 'streamAllLogs failed'));
    return { stop: () => { for (const s of streams) s.destroy(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', ['exec', id, 'node', 'dist/index.js', ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const token = this.fleetConfig.readTokens()[index];
    if (!token) throw new Error(`Token not found for ${id}`);
    return token;
  }

  async readInstanceConfig(id: string): Promise<object> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    return this.fleetConfig.readInstanceConfig(index) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    const index = parseInt(id.replace('openclaw-', ''), 10);
    this.fleetConfig.writeInstanceConfig(index, config);
  }

  async scaleFleet(count: number, _fleetDir: string): Promise<FleetStatus> {
    const currentContainers = await this.docker.listFleetContainers();
    const currentCount = currentContainers.length;

    if (count === currentCount) {
      return this.refresh();
    }

    if (count > currentCount) {
      for (let next = currentCount + 1; next <= count; next += 1) {
        await this.createInstance({ name: `openclaw-${next}` });
      }
      return this.refresh();
    }

    for (let idx = currentCount; idx > count; idx -= 1) {
      await this.removeInstance(`openclaw-${idx}`);
    }

    return this.refresh();
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
      if (text) lines.push(...text.split('\n').map((l) => l.trim()).filter(Boolean));
      offset = end;
    }
    if (lines.length === 0) {
      const fallback = chunk.toString('utf-8').trim();
      if (fallback) lines.push(...fallback.split('\n').map((l) => l.trim()).filter(Boolean));
    }
    return lines;
  }

  private writeFleetCount(count: number, baseVars?: Record<string, string>): void {
    const vars = { ...(baseVars ?? this.fleetConfig.readFleetEnvRaw()) };
    vars.COUNT = String(Math.max(0, count));
    this.fleetConfig.writeFleetConfig(vars);
  }
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}
