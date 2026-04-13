import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerService } from '../../src/services/docker.js';

const mockContainer = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  stats: vi.fn().mockResolvedValue({
    cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 50 }, system_cpu_usage: 500 },
    memory_stats: { usage: 420_000_000, limit: 8_000_000_000 },
  }),
  inspect: vi.fn().mockResolvedValue({
    State: {
      Status: 'running',
      StartedAt: new Date(Date.now() - 86400_000).toISOString(),
      Health: { Status: 'healthy' },
    },
    Config: { Image: 'openclaw:local' },
  }),
  logs: vi.fn().mockResolvedValue({ on: vi.fn(), destroy: vi.fn() }),
};

const mockReplacementContainer = {
  start: vi.fn(),
  remove: vi.fn(),
};

const mockDocker = {
  listContainers: vi.fn().mockResolvedValue([
    { Names: ['/openclaw-1'], Id: 'abc123', State: 'running' },
    { Names: ['/openclaw-2'], Id: 'def456', State: 'running' },
  ]),
  getContainer: vi.fn().mockReturnValue(mockContainer),
  df: vi.fn().mockResolvedValue({ Volumes: [] }),
};

describe('DockerService', () => {
  let svc: DockerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocker.createContainer = vi.fn();
    mockContainer.inspect.mockResolvedValue({
      State: {
        Status: 'running',
        StartedAt: new Date(Date.now() - 86400_000).toISOString(),
        Health: { Status: 'healthy' },
      },
      Config: { Image: 'openclaw:local' },
    });
    svc = new DockerService(mockDocker as any);
  });

  it('lists fleet containers', async () => {
    const containers = await svc.listFleetContainers();
    expect(containers).toHaveLength(2);
    expect(containers[0].name).toBe('openclaw-1');
    expect(containers[0].runtime).toBe('openclaw');
  });

  it('starts a container', async () => {
    await svc.startContainer('openclaw-1');
    expect(mockDocker.getContainer).toHaveBeenCalledWith('openclaw-1');
    expect(mockContainer.start).toHaveBeenCalled();
  });

  it('stops a container', async () => {
    await svc.stopContainer('openclaw-1');
    expect(mockContainer.stop).toHaveBeenCalled();
  });

  it('restarts a container', async () => {
    await svc.restartContainer('openclaw-1');
    expect(mockContainer.restart).toHaveBeenCalled();
  });

  it('renames a container', async () => {
    await svc.renameContainer('openclaw-1', 'team-renamed');
    expect(mockDocker.getContainer).toHaveBeenCalledWith('openclaw-1');
    expect(mockContainer.rename).toHaveBeenCalledWith({ name: 'team-renamed' });
  });

  it('recreates a stopped managed container with renamed bind mounts and keeps it stopped', async () => {
    mockContainer.inspect.mockResolvedValue({
      Config: {
        Image: 'openclaw:local',
        Labels: {
          'dev.claw-fleet.managed': 'true',
          'dev.claw-fleet.instance-index': '2',
          'dev.claw-fleet.runtime': 'openclaw',
        },
        Env: ['HOME=/home/node', 'OPENCLAW_GATEWAY_TOKEN=secret-token', 'TZ=UTC'],
        Cmd: ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789'],
        ExposedPorts: { '18789/tcp': {} },
        Healthcheck: { Test: ['CMD', 'true'] },
      },
      HostConfig: {
        AutoRemove: false,
        Binds: [
          '/tmp/managed/team-alpha/config:/home/node/.openclaw',
          '/tmp/managed/team-alpha/workspace:/home/node/.openclaw/workspace',
          '/tmp/managed/team-alpha/config/.npm:/home/node/.npm',
        ],
        PortBindings: {
          '18789/tcp': [{ HostPort: '18809' }],
        },
        Init: true,
        RestartPolicy: { Name: 'unless-stopped' },
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        ReadonlyRootfs: true,
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec' },
        NanoCpus: 1500000000,
        Memory: 2147483648,
      },
    });
    mockDocker.createContainer = vi.fn().mockResolvedValue(mockReplacementContainer);

    await svc.recreateStoppedManagedContainer({
      currentName: 'team-alpha',
      nextName: 'team-renamed',
      configDir: '/tmp/managed/team-renamed/config',
      workspaceDir: '/tmp/managed/team-renamed/workspace',
      npmDir: '/tmp/managed/team-renamed/config/.npm',
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-renamed',
      Image: 'openclaw:local',
      Labels: expect.objectContaining({
        'dev.claw-fleet.managed': 'true',
        'dev.claw-fleet.instance-index': '2',
        'dev.claw-fleet.runtime': 'openclaw',
      }),
      HostConfig: expect.objectContaining({
        Binds: [
          '/tmp/managed/team-renamed/config:/home/node/.openclaw',
          '/tmp/managed/team-renamed/workspace:/home/node/.openclaw/workspace',
          '/tmp/managed/team-renamed/config/.npm:/home/node/.npm',
        ],
        PortBindings: {
          '18789/tcp': [{ HostPort: '18809' }],
        },
      }),
    }));
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(mockReplacementContainer.start).not.toHaveBeenCalled();
  });

  it('createManagedContainer creates and starts a hardened managed container with npm cache mount', async () => {
    const createdContainer = { start: vi.fn().mockResolvedValue(undefined) };
    mockDocker.listContainers.mockResolvedValue([]);
    mockDocker.createContainer = vi.fn().mockResolvedValue(createdContainer);

    await svc.createManagedContainer({
      name: 'team-alpha',
      index: 2,
      image: 'ghcr.io/acme/openclaw:latest',
      gatewayPort: 18809,
      token: 'secret-token',
      timezone: 'UTC',
      configDir: '/tmp/config/team-alpha',
      workspaceDir: '/tmp/workspace/team-alpha',
      npmDir: '/tmp/config/team-alpha/.npm',
      cpuLimit: '1.5',
      memLimit: '2G',
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-alpha',
      Image: 'ghcr.io/acme/openclaw:latest',
      Labels: expect.objectContaining({
        'dev.claw-fleet.managed': 'true',
        'dev.claw-fleet.instance-index': '2',
        'dev.claw-fleet.runtime': 'openclaw',
      }),
      Env: expect.arrayContaining([
        'HOME=/home/node',
        'TERM=xterm-256color',
        'OPENCLAW_GATEWAY_TOKEN=secret-token',
        'TZ=UTC',
      ]),
      HostConfig: expect.objectContaining({
        Binds: [
          '/tmp/config/team-alpha:/home/node/.openclaw',
          '/tmp/workspace/team-alpha:/home/node/.openclaw/workspace',
          '/tmp/config/team-alpha/.npm:/home/node/.npm',
        ],
        PortBindings: {
          '18789/tcp': [{ HostPort: '18809' }],
        },
        NanoCpus: 1500000000,
        Memory: 2147483648,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
      }),
    }));
    expect(createdContainer.start).toHaveBeenCalled();
  });

  it('createManagedContainer can disable the default OpenClaw healthcheck for Hermes containers', async () => {
    const createdContainer = { start: vi.fn().mockResolvedValue(undefined) };
    mockDocker.listContainers.mockResolvedValue([]);
    mockDocker.createContainer = vi.fn().mockResolvedValue(createdContainer);

    await svc.createManagedContainer({
      name: 'hermes-lab',
      index: 3,
      runtime: 'hermes',
      image: 'ghcr.io/nousresearch/hermes-agent:latest',
      gatewayPort: 0,
      token: '',
      timezone: 'UTC',
      configDir: '/tmp/hermes-lab',
      workspaceDir: '/tmp/hermes-lab/workspace',
      cpuLimit: '1',
      memLimit: '1G',
      binds: ['/tmp/hermes-lab:/data/hermes'],
      extraEnv: ['HERMES_HOME=/data/hermes'],
      command: ['hermes', 'gateway'],
      exposedTcpPorts: [],
      healthcheck: null,
    });

    expect(mockDocker.createContainer).toHaveBeenCalledWith(expect.objectContaining({
      Labels: expect.objectContaining({
        'dev.claw-fleet.runtime': 'hermes',
      }),
      Cmd: ['hermes', 'gateway'],
      ExposedPorts: undefined,
      Healthcheck: undefined,
      HostConfig: expect.objectContaining({
        Binds: ['/tmp/hermes-lab:/data/hermes'],
        PortBindings: undefined,
      }),
    }));
    expect(createdContainer.start).toHaveBeenCalled();
  });

  it('createManagedContainer is a no-op when the container already exists', async () => {
    mockDocker.listContainers.mockResolvedValue([
      { Names: ['/team-alpha'], Id: 'abc123', State: 'running' },
    ]);
    mockDocker.createContainer = vi.fn();

    await svc.createManagedContainer({
      name: 'team-alpha',
      index: 2,
      image: 'ghcr.io/acme/openclaw:latest',
      gatewayPort: 18809,
      token: 'secret-token',
      timezone: 'UTC',
      configDir: '/tmp/config/team-alpha',
      workspaceDir: '/tmp/workspace/team-alpha',
      cpuLimit: '1.5',
      memLimit: '2G',
    });

    expect(mockDocker.createContainer).not.toHaveBeenCalled();
  });

  it('listFleetContainers reads the runtime label and defaults legacy containers to openclaw', async () => {
    mockDocker.listContainers.mockResolvedValue([
      {
        Names: ['/hermes-lab'],
        Id: 'abc123',
        State: 'running',
        Labels: {
          'dev.claw-fleet.managed': 'true',
          'dev.claw-fleet.instance-index': '2',
          'dev.claw-fleet.runtime': 'hermes',
        },
      },
      {
        Names: ['/openclaw-1'],
        Id: 'def456',
        State: 'running',
        Labels: {},
      },
    ]);

    const containers = await svc.listFleetContainers();

    expect(containers).toEqual([
      expect.objectContaining({ name: 'openclaw-1', runtime: 'openclaw', index: 1 }),
      expect.objectContaining({ name: 'hermes-lab', runtime: 'hermes', index: 2 }),
    ]);
  });

  it('removes a container with force=true', async () => {
    await svc.removeContainer('openclaw-1');
    expect(mockContainer.remove).toHaveBeenCalledWith({ force: true });
  });

  it('getDiskUsage returns volume sizes keyed by name', async () => {
    mockDocker.df.mockResolvedValue({
      Volumes: [
        { Name: 'vol-a', UsageData: { Size: 1024 } },
        { Name: 'vol-b', UsageData: { Size: 2048 } },
      ],
    });

    const usage = await svc.getDiskUsage();

    expect(usage).toEqual({ 'vol-a': 1024, 'vol-b': 2048 });
  });

  it('getDiskUsage returns empty record when no volumes', async () => {
    mockDocker.df.mockResolvedValue({ Volumes: [] });
    expect(await svc.getDiskUsage()).toEqual({});
  });

  it('getDiskUsage defaults missing UsageData to 0', async () => {
    mockDocker.df.mockResolvedValue({ Volumes: [{ Name: 'vol-x' }] });
    expect(await svc.getDiskUsage()).toEqual({ 'vol-x': 0 });
  });

  it('getContainerLogs (follow=false) calls container.logs with correct opts', async () => {
    const fakeStream = { on: vi.fn(), destroy: vi.fn() };
    mockContainer.logs.mockResolvedValue(fakeStream);

    const result = await svc.getContainerLogs('openclaw-1', { follow: false, tail: 100 });

    expect(mockContainer.logs).toHaveBeenCalledWith({
      follow: false,
      stdout: true,
      stderr: true,
      tail: 100,
      timestamps: true,
    });
    expect(result).toBe(fakeStream);
  });

  it('getContainerLogs (follow=true) calls container.logs with follow=true', async () => {
    const fakeStream = { on: vi.fn(), destroy: vi.fn() };
    mockContainer.logs.mockResolvedValue(fakeStream);

    await svc.getContainerLogs('openclaw-1', { follow: true, tail: 50 });

    expect(mockContainer.logs).toHaveBeenCalledWith(expect.objectContaining({ follow: true, tail: 50 }));
  });

  it('gets container stats', async () => {
    const stats = await svc.getContainerStats('openclaw-1');
    expect(stats.cpu).toBeTypeOf('number');
    expect(stats.memory.used).toBe(420_000_000);
    expect(stats.memory.limit).toBe(8_000_000_000);
  });

  it('getContainerStats returns cpu=0 when sysDelta is 0', async () => {
    mockContainer.stats.mockResolvedValue({
      cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500, online_cpus: 2 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
      memory_stats: { usage: 0, limit: 0 },
    });

    const stats = await svc.getContainerStats('openclaw-1');

    expect(stats.cpu).toBe(0);
  });

  it('getContainerStats defaults memory to 0 when fields missing', async () => {
    mockContainer.stats.mockResolvedValue({
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: {},
    });

    const stats = await svc.getContainerStats('openclaw-1');

    expect(stats.memory.used).toBe(0);
    expect(stats.memory.limit).toBe(0);
  });

  it('inspects a container', async () => {
    const info = await svc.inspectContainer('openclaw-1');
    expect(info.status).toBe('running');
    expect(info.health).toBe('healthy');
    expect(info.image).toBe('openclaw:local');
    expect(info.uptime).toBeGreaterThan(0);
  });

  it('inspectContainer returns uptime=0 for stopped container', async () => {
    mockContainer.inspect.mockResolvedValue({
      State: {
        Status: 'exited',
        StartedAt: new Date(Date.now() - 60_000).toISOString(),
        Health: { Status: 'none' },
      },
      Config: { Image: 'openclaw:local' },
    });

    const info = await svc.inspectContainer('openclaw-1');

    expect(info.status).toBe('exited');
    expect(info.uptime).toBe(0);
  });

  it('inspectContainer falls back to "none" when Health is absent', async () => {
    mockContainer.inspect.mockResolvedValue({
      State: { Status: 'running', StartedAt: new Date().toISOString() },
      Config: { Image: 'openclaw:local' },
    });

    const info = await svc.inspectContainer('openclaw-1');

    expect(info.health).toBe('none');
  });

  it('getContainerGatewayToken returns the token from container env', async () => {
    mockContainer.inspect.mockResolvedValue({
      State: {
        Status: 'running',
        StartedAt: new Date(Date.now() - 60_000).toISOString(),
        Health: { Status: 'healthy' },
      },
      Config: {
        Image: 'openclaw:local',
        Env: ['OPENCLAW_GATEWAY_TOKEN=secret-token', 'TZ=UTC'],
      },
    });

    await expect(svc.getContainerGatewayToken('openclaw-1')).resolves.toBe('secret-token');
  });

  it('listFleetContainers includes containers with managed label regardless of name', async () => {
    mockDocker.listContainers.mockResolvedValue([
      {
        Names: ['/custom-name'],
        Id: 'aaa',
        State: 'running',
        Labels: { 'dev.claw-fleet.managed': 'true', 'dev.claw-fleet.instance-index': '3' },
      },
    ]);

    const containers = await svc.listFleetContainers();

    expect(containers).toHaveLength(1);
    expect(containers[0].name).toBe('custom-name');
    expect(containers[0].index).toBe(3);
  });

  describe('error propagation', () => {
    it('startContainer propagates Docker errors', async () => {
      mockContainer.start.mockRejectedValue(new Error('container already running'));
      await expect(svc.startContainer('openclaw-1')).rejects.toThrow('container already running');
    });

    it('stopContainer propagates Docker errors', async () => {
      mockContainer.stop.mockRejectedValue(new Error('no such container'));
      await expect(svc.stopContainer('openclaw-1')).rejects.toThrow('no such container');
    });

    it('inspectContainer propagates Docker errors', async () => {
      mockContainer.inspect.mockRejectedValue(new Error('no such container'));
      await expect(svc.inspectContainer('openclaw-1')).rejects.toThrow('no such container');
    });

    it('listFleetContainers propagates daemon errors', async () => {
      mockDocker.listContainers.mockRejectedValue(new Error('cannot connect to Docker daemon'));
      await expect(svc.listFleetContainers()).rejects.toThrow('cannot connect to Docker daemon');
    });
  });
});
