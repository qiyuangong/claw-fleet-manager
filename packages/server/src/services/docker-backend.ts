// packages/server/src/services/docker-backend.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import type { DockerService } from './docker.js';
import type { ComposeGenerator } from './compose-generator.js';
import { FleetConfigService } from './fleet-config.js';
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
    private composeGenerator: ComposeGenerator,
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

  async createInstance(_opts: CreateInstanceOpts): Promise<FleetInstance> {
    const config = this.fleetConfig.readFleetConfig();
    const newCount = config.count + 1;
    const newIndex = newCount;

    const portMap = this.tailscale?.allocatePorts([newIndex]) ?? new Map<number, number>();
    this.composeGenerator.generate(
      newCount,
      this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: this.fleetDir });

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
    const config = this.fleetConfig.readFleetConfig();
    const newCount = config.count - 1;

    await this.tailscale?.teardown(highestIndex);

    try {
      await this.docker.stopContainer(`openclaw-${highestIndex}`);
    } catch {
      // already stopped
    }

    this.composeGenerator.generate(
      newCount,
      this.tailscaleHostname ? {
        hostname: this.tailscaleHostname,
        portMap: this.tailscale?.allocatePorts([]) ?? new Map(),
      } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: this.fleetDir });
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
    })();
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
    })();
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

  async scaleFleet(count: number, fleetDir: string): Promise<FleetStatus> {
    const currentContainers = await this.docker.listFleetContainers();
    const currentIndices = currentContainers.map((c) =>
      parseInt(c.name.replace('openclaw-', ''), 10),
    );
    const newIndices = Array.from({ length: count }, (_, i) => i + 1).filter(
      (i) => !currentIndices.includes(i),
    );
    const removedIndices = currentIndices.filter((i) => i > count);

    for (const container of currentContainers.filter((c) => {
      const idx = parseInt(c.name.replace('openclaw-', ''), 10);
      return idx > count;
    })) {
      try { await this.docker.stopContainer(container.name); } catch { /* ignored */ }
    }

    for (const idx of removedIndices) {
      await this.tailscale?.teardown(idx);
    }

    const portMap = this.tailscale?.allocatePorts(newIndices) ?? new Map<number, number>();
    this.composeGenerator.generate(
      count,
      this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
    );

    await execFileAsync('docker', ['compose', 'up', '-d', '--remove-orphans'], { cwd: fleetDir });

    const portStep = this.fleetConfig.readFleetConfig().portStep;
    for (const idx of newIndices) {
      const gwPort = BASE_GW_PORT + (idx - 1) * portStep;
      try {
        await this.tailscale?.setup(idx, gwPort);
      } catch (err) {
        this.log?.error({ err, idx }, 'Tailscale setup failed');
      }
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
}
