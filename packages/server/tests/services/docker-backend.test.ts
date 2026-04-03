// packages/server/tests/services/docker-backend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/services/docker-instance-provisioning.js', () => ({
  provisionDockerInstance: vi.fn(),
}));
import { provisionDockerInstance } from '../../src/services/docker-instance-provisioning.js';
import { DockerBackend } from '../../src/services/docker-backend.js';

const mockDocker = {
  startContainer: vi.fn().mockResolvedValue(undefined),
  stopContainer: vi.fn().mockResolvedValue(undefined),
  restartContainer: vi.fn().mockResolvedValue(undefined),
  createManagedContainer: vi.fn().mockResolvedValue(undefined),
  removeContainer: vi.fn().mockResolvedValue(undefined),
  listFleetContainers: vi.fn().mockResolvedValue([]),
  getContainerStats: vi.fn().mockResolvedValue({ cpu: 0, memory: { used: 0, limit: 0 } }),
  inspectContainer: vi.fn().mockResolvedValue({ status: 'running', health: 'healthy', image: 'openclaw:local', uptime: 100 }),
  getDiskUsage: vi.fn().mockResolvedValue({}),
  getContainerLogs: vi.fn().mockReturnValue({ on: vi.fn(), destroy: vi.fn() }),
};

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({
    baseDir: '/tmp/managed',
    count: 3,
    portStep: 20,
    configBase: '/tmp/cfg',
    workspaceBase: '/tmp/ws',
    openclawImage: 'openclaw:local',
    tz: 'Asia/Shanghai',
    enableNpmPackages: false,
    cpuLimit: '4',
    memLimit: '4G',
  }),
  readFleetEnvRaw: vi.fn().mockReturnValue({}),
  readTokens: vi.fn().mockReturnValue({ 1: 'token-abc123' }),
  writeTokens: vi.fn(),
  writeFleetConfig: vi.fn(),
  readInstanceConfig: vi.fn().mockReturnValue({ gateway: {} }),
  writeInstanceConfig: vi.fn(),
  ensureFleetDirectories: vi.fn(),
  getConfigBase: vi.fn().mockReturnValue('/tmp/managed'),
  getWorkspaceBase: vi.fn().mockReturnValue('/tmp/managed/<instance>/workspace'),
  getDockerConfigDir: vi.fn((id: string) => `/tmp/managed/${id}/config`),
  getDockerWorkspaceDir: vi.fn((id: string) => `/tmp/managed/${id}/workspace`),
};

describe('DockerBackend', () => {
  let backend: DockerBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetConfig.readFleetEnvRaw.mockReturnValue({});
    mockFleetConfig.readInstanceConfig.mockReturnValue({ gateway: {} });
    backend = new DockerBackend(
      mockDocker as any,
      mockFleetConfig as any,
      '/tmp/fleet',
      null, // no tailscale
      null,
    );
  });

  it('getCachedStatus() returns null before first refresh', () => {
    expect(backend.getCachedStatus()).toBeNull();
  });

  it('start() delegates to DockerService', async () => {
    await backend.start('openclaw-1');
    expect(mockDocker.startContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('stop() delegates to DockerService', async () => {
    await backend.stop('openclaw-1');
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('restart() delegates to DockerService', async () => {
    await backend.restart('openclaw-1');
    expect(mockDocker.restartContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('revealToken() returns token from fleetConfig', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([{ name: 'openclaw-1', id: 'abc', state: 'running', index: 1 }]);
    const token = await backend.revealToken('openclaw-1');
    expect(token).toBe('token-abc123');
  });

  it('revealToken() throws for unknown instance', async () => {
    mockFleetConfig.readTokens.mockReturnValue({});
    await expect(backend.revealToken('openclaw-99')).rejects.toThrow();
  });

  it('readInstanceConfig() delegates to fleetConfig', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([{ name: 'openclaw-1', id: 'abc', state: 'running', index: 1 }]);
    const cfg = await backend.readInstanceConfig('openclaw-1');
    expect(mockFleetConfig.readInstanceConfig).toHaveBeenCalledWith('openclaw-1');
    expect(cfg).toEqual({ gateway: {} });
  });

  it('writeInstanceConfig() delegates to fleetConfig', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([{ name: 'openclaw-1', id: 'abc', state: 'running', index: 1 }]);
    await backend.writeInstanceConfig('openclaw-1', { gateway: { port: 18789 } });
    expect(mockFleetConfig.writeInstanceConfig).toHaveBeenCalledWith('openclaw-1', { gateway: { port: 18789 } });
  });

  it('createInstance() accepts named docker instance ids', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
    ]);
    mockDocker.listFleetContainers.mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
    ]).mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
      { name: 'team-alpha', id: 'def', state: 'running', index: 2 },
    ]);

    const instance = await backend.createInstance({ name: 'team-alpha' });
    expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-alpha',
      index: 2,
      configDir: '/tmp/managed/team-alpha/config',
      workspaceDir: '/tmp/managed/team-alpha/workspace',
    }));
    expect(instance.id).toBe('team-alpha');
  });

  it('createInstance() applies per-instance Docker overrides and persists portStep metadata', async () => {
    mockFleetConfig.readFleetEnvRaw.mockReturnValue({
      BASE_URL: 'https://api.example.com/v1',
      API_KEY: 'fleet-key',
      MODEL_ID: 'gpt-4',
    });
    mockDocker.listFleetContainers.mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
    ]).mockResolvedValueOnce([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
      { name: 'team-beta', id: 'def', state: 'running', index: 2 },
    ]);
    mockFleetConfig.readInstanceConfig.mockReturnValue({ clawFleet: { portStep: 25 } });

    const instance = await backend.createInstance({
      kind: 'docker',
      name: 'team-beta',
      apiKey: 'sk-test',
      image: 'openclaw:latest',
      cpuLimit: '2',
      memoryLimit: '2G',
      portStep: 25,
      enableNpmPackages: true,
    });

    expect(provisionDockerInstance).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'team-beta',
      index: 2,
      portStep: 25,
      vars: expect.objectContaining({
        BASE_URL: 'https://api.example.com/v1',
        API_KEY: 'sk-test',
        MODEL_ID: 'gpt-4',
      }),
      configOverride: expect.objectContaining({
        clawFleet: { portStep: 25 },
      }),
    }));
    expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-beta',
      index: 2,
      image: 'openclaw:latest',
      gatewayPort: 18814,
      cpuLimit: '2',
      memLimit: '2G',
      npmDir: '/tmp/managed/team-beta/config/.npm',
    }));
    expect(instance.port).toBe(18814);
    expect(instance.id).toBe('team-beta');
  });

  it('refresh() returns FleetStatus with mode=docker', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'abc', state: 'running', index: 1 },
    ]);
    const status = await backend.refresh();
    expect(status.mode).toBe('docker');
    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('openclaw-1');
    expect(status.instances[0].index).toBe(1);
  });

  it('refresh() prefers per-instance portStep metadata when available', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'team-beta', id: 'abc', state: 'running', index: 2 },
    ]);
    mockFleetConfig.readInstanceConfig.mockReturnValue({ clawFleet: { portStep: 25 } });

    const status = await backend.refresh();

    expect(status.instances[0].port).toBe(18814);
  });

  it('getCachedStatus() returns the last refresh result', async () => {
    await backend.refresh();
    expect(backend.getCachedStatus()).not.toBeNull();
    expect(backend.getCachedStatus()?.mode).toBe('docker');
  });

  it('createInstance() uses the next available slot index for named instances', async () => {
    mockDocker.listFleetContainers
      .mockResolvedValueOnce([
        { name: 'openclaw-1', id: 'a', state: 'running', index: 1 },
        { name: 'openclaw-3', id: 'b', state: 'running', index: 3 },
      ])
      .mockResolvedValueOnce([
        { name: 'openclaw-1', id: 'a', state: 'running', index: 1 },
        { name: 'openclaw-3', id: 'b', state: 'running', index: 3 },
        { name: 'team-alpha', id: 'c', state: 'running', index: 2 },
      ]);

    await backend.createInstance({ name: 'team-alpha' });

    expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({ index: 2 }));
  });

  it('removeInstance() removes a named docker instance directly', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'a', state: 'running', index: 1 },
      { name: 'team-alpha', id: 'b', state: 'running', index: 2 },
    ]);

    await backend.removeInstance('team-alpha');

    expect(mockDocker.removeContainer).toHaveBeenCalledWith('team-alpha');
  });
});
