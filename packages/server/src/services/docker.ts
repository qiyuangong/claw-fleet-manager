import Dockerode from 'dockerode';

export interface ContainerInfo {
  name: string;
  id: string;
  state: string;
  index?: number;
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

export interface ManagedContainerSpec {
  name: string;
  index: number;
  image: string;
  gatewayPort: number;
  token: string;
  timezone: string;
  configDir: string;
  workspaceDir: string;
  npmDir?: string;
  cpuLimit: string;
  memLimit: string;
}

export class DockerService {
  constructor(private docker: Dockerode = new Dockerode()) {}

  async listFleetContainers(): Promise<ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((container) => {
        const labels = container.Labels ?? {};
        return labels['dev.claw-fleet.managed'] === 'true'
          || container.Names.some((name) => /^\/openclaw-\d+$/.test(name));
      })
      .map((container) => ({
        name: container.Names[0].replace(/^\//, ''),
        id: container.Id,
        state: container.State,
        index: parseContainerIndex(container),
      }))
      .sort((a, b) => {
        if (a.index !== undefined && b.index !== undefined) return a.index - b.index;
        if (a.index !== undefined) return -1;
        if (b.index !== undefined) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
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

  async renameContainer(currentName: string, nextName: string): Promise<void> {
    await this.docker.getContainer(currentName).rename({ name: nextName });
  }

  async createManagedContainer(spec: ManagedContainerSpec): Promise<void> {
    const existing = await this.findContainer(spec.name);
    if (existing) {
      return;
    }

    const binds = [
      `${spec.configDir}:/home/node/.openclaw`,
      `${spec.workspaceDir}:/home/node/.openclaw/workspace`,
    ];
    if (spec.npmDir) {
      binds.push(`${spec.npmDir}:/home/node/.npm`);
    }

    const cpus = parseCpuLimit(spec.cpuLimit);
    const memory = parseMemoryLimit(spec.memLimit);

    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Labels: {
        'dev.claw-fleet.managed': 'true',
        'dev.claw-fleet.instance-index': String(spec.index),
      },
      Env: [
        'HOME=/home/node',
        'TERM=xterm-256color',
        `OPENCLAW_GATEWAY_TOKEN=${spec.token}`,
        `TZ=${spec.timezone}`,
      ],
      Cmd: ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789'],
      ExposedPorts: {
        '18789/tcp': {},
      },
      Healthcheck: {
        Test: [
          'CMD',
          'node',
          '-e',
          "fetch('http://127.0.0.1:18789/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ],
        Interval: 30 * 1_000_000_000,
        Timeout: 5 * 1_000_000_000,
        Retries: 5,
        StartPeriod: 20 * 1_000_000_000,
      },
      HostConfig: {
        AutoRemove: false,
        Binds: binds,
        PortBindings: {
          '18789/tcp': [{ HostPort: String(spec.gatewayPort) }],
        },
        Init: true,
        RestartPolicy: { Name: 'unless-stopped' },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: {
          '/tmp': 'rw,nosuid,nodev,noexec',
        },
        NanoCpus: cpus,
        Memory: memory,
      },
    });

    await container.start();
  }

  async removeContainer(name: string): Promise<void> {
    const container = this.docker.getContainer(name);
    await container.remove({ force: true });
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

  private async findContainer(name: string) {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: [name] } as any,
    });
    return containers.find((container) => container.Names.some((n) => n === `/${name}`)) ?? null;
  }
}

function parseContainerIndex(container: {
  Names: string[];
  Labels?: Record<string, string>;
}): number | undefined {
  const labelIndex = container.Labels?.['dev.claw-fleet.instance-index'];
  if (labelIndex) {
    const parsed = Number.parseInt(labelIndex, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const name = container.Names[0]?.replace(/^\//, '') ?? '';
  const legacyMatch = name.match(/^openclaw-(\d+)$/);
  if (!legacyMatch) return undefined;

  const parsed = Number.parseInt(legacyMatch[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseCpuLimit(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1_000_000_000) : 0;
}

function parseMemoryLimit(value: string): number {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([KMGT]?)B?$/);
  if (!match) return 0;
  const amount = Number.parseFloat(match[1]);
  const unit = match[2] ?? '';
  const multiplier = unit === 'K' ? 1024
    : unit === 'M' ? 1024 ** 2
    : unit === 'G' ? 1024 ** 3
    : unit === 'T' ? 1024 ** 4
    : 1;
  return Math.round(amount * multiplier);
}
