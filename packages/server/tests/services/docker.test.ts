import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerService } from '../../src/services/docker.js';

const mockContainer = {
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
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
    svc = new DockerService(mockDocker as any);
  });

  it('lists fleet containers', async () => {
    const containers = await svc.listFleetContainers();
    expect(containers).toHaveLength(2);
    expect(containers[0].name).toBe('openclaw-1');
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

  it('gets container stats', async () => {
    const stats = await svc.getContainerStats('openclaw-1');
    expect(stats.cpu).toBeTypeOf('number');
    expect(stats.memory.used).toBe(420_000_000);
    expect(stats.memory.limit).toBe(8_000_000_000);
  });

  it('inspects a container', async () => {
    const info = await svc.inspectContainer('openclaw-1');
    expect(info.status).toBe('running');
    expect(info.health).toBe('healthy');
    expect(info.image).toBe('openclaw:local');
    expect(info.uptime).toBeGreaterThan(0);
  });
});
