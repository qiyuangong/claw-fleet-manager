import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FleetInstance, FleetStatus } from '../types.js';
import { FleetConfigService } from './fleet-config.js';
import type { DockerService } from './docker.js';
import type { TailscaleService } from './tailscale.js';

export const BASE_GW_PORT = 18789;

export class MonitorService {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private docker: DockerService,
    private fleetConfig: FleetConfigService,
    private tailscale: TailscaleService | null = null,
  ) {}

  start(intervalMs = 5000): void {
    void this.refresh();
    this.interval = setInterval(() => {
      void this.refresh();
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getStatus(): FleetStatus | null {
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
          mode: 'docker',
          index,
          status: this.mapStatus(inspection.status),
          port: BASE_GW_PORT + (index - 1) * config.portStep,
          token: FleetConfigService.maskToken(tokens[index] ?? ''),
          tailscaleUrl: this.tailscale?.getUrl(index) ?? undefined,
          uptime: inspection.uptime,
          cpu: stats.cpu,
          memory: stats.memory,
          disk: {
            config: await this.getDirectorySize(join(configBase, String(index))),
            workspace: await this.getDirectorySize(join(workspaceBase, String(index))),
          },
          health: this.mapHealth(inspection.health),
          image: inspection.image,
        };
      }),
    );

    try {
      const diskUsage = await this.docker.getDiskUsage();
      for (const instance of instances) {
        for (const [name, size] of Object.entries(diskUsage)) {
          if (name.includes(`instances/${instance.index}`) || name.includes(`config/${instance.index}`)) {
            instance.disk.config = size;
          }
          if (name.includes(`workspaces/${instance.index}`)) {
            instance.disk.workspace = size;
          }
        }
      }
    } catch {
      // best effort
    }

    const status: FleetStatus = {
      mode: 'docker',
      instances,
      totalRunning: instances.filter((instance) => instance.status === 'running').length,
      updatedAt: Date.now(),
    };

    this.cache = status;
    return status;
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

  private async getDirectorySize(path: string): Promise<number> {
    try {
      const stats = await stat(path);
      if (!stats.isDirectory()) {
        return stats.size;
      }

      const entries = await readdir(path);
      const sizes = await Promise.all(
        entries.map((entry) => this.getDirectorySize(join(path, entry))),
      );
      return sizes.reduce((total, size) => total + size, 0);
    } catch {
      return 0;
    }
  }
}
