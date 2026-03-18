import Dockerode from 'dockerode';

export interface ContainerInfo {
  name: string;
  id: string;
  state: string;
}

export interface ContainerStats {
  cpu: number;
  memory: { used: number; limit: number };
}

export interface ContainerInspection {
  status: string;
  health: string;
  image: string;
  uptime: number;
}

export class DockerService {
  constructor(private docker: Dockerode = new Dockerode()) {}

  async listFleetContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((container) => container.Names.some((name) => /^\/openclaw-\d+$/.test(name)))
      .map((container) => ({
        name: container.Names[0].replace(/^\//, ''),
        id: container.Id,
        state: container.State,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  async startContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).start();
  }

  async stopContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).stop();
  }

  async restartContainer(name: string): Promise<void> {
    await this.docker.getContainer(name).restart();
  }

  async getContainerStats(name: string): Promise<ContainerStats> {
    const stats = await this.docker.getContainer(name).stats({ stream: false }) as any;
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpus = stats.cpu_stats.online_cpus || 1;
    const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0;

    return {
      cpu: Math.round(cpu * 100) / 100,
      memory: {
        used: stats.memory_stats.usage ?? 0,
        limit: stats.memory_stats.limit ?? 0,
      },
    };
  }

  async inspectContainer(name: string): Promise<ContainerInspection> {
    const info = await this.docker.getContainer(name).inspect();
    const startedAt = new Date(info.State.StartedAt).getTime();
    const uptime = info.State.Status === 'running'
      ? Math.floor((Date.now() - startedAt) / 1000)
      : 0;

    return {
      status: info.State.Status,
      health: info.State.Health?.Status ?? 'none',
      image: info.Config.Image,
      uptime,
    };
  }

  async getDiskUsage(): Promise<Record<string, number>> {
    const df = await this.docker.df() as any;
    const result: Record<string, number> = {};
    for (const volume of df.Volumes ?? []) {
      result[volume.Name] = volume.UsageData?.Size ?? 0;
    }
    return result;
  }

  getContainerLogs(name: string, opts: { follow: boolean; tail: number }) {
    const container = this.docker.getContainer(name);
    if (opts.follow) {
      return container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: opts.tail,
        timestamps: true,
      });
    }

    return container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail: opts.tail,
      timestamps: true,
    });
  }
}
