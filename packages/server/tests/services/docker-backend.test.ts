// packages/server/tests/services/docker-backend.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerBackend } from '../../src/services/docker-backend.js';

const mockDocker = {
  startContainer: vi.fn().mockResolvedValue(undefined),
  stopContainer: vi.fn().mockResolvedValue(undefined),
  restartContainer: vi.fn().mockResolvedValue(undefined),
  listFleetContainers: vi.fn().mockResolvedValue([]),
  getContainerStats: vi.fn().mockResolvedValue({ cpu: 0, memory: { used: 0, limit: 0 } }),
  inspectContainer: vi.fn().mockResolvedValue({ status: 'running', health: 'healthy', image: 'openclaw:local', uptime: 100 }),
  getDiskUsage: vi.fn().mockResolvedValue({}),
  getContainerLogs: vi.fn().mockReturnValue({ on: vi.fn(), destroy: vi.fn() }),
};

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({ portStep: 20, configBase: '/tmp/cfg', workspaceBase: '/tmp/ws' }),
  readTokens: vi.fn().mockReturnValue({ 1: 'token-abc123' }),
  readInstanceConfig: vi.fn().mockReturnValue({ gateway: {} }),
  writeInstanceConfig: vi.fn(),
  getConfigBase: vi.fn().mockReturnValue('/tmp/cfg'),
  getWorkspaceBase: vi.fn().mockReturnValue('/tmp/ws'),
};

const mockComposeGen = { generate: vi.fn() };

describe('DockerBackend', () => {
  let backend: DockerBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new DockerBackend(
      mockDocker as any,
      mockComposeGen as any,
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
    const token = await backend.revealToken('openclaw-1');
    expect(token).toBe('token-abc123');
  });

  it('revealToken() throws for unknown instance', async () => {
    mockFleetConfig.readTokens.mockReturnValue({});
    await expect(backend.revealToken('openclaw-99')).rejects.toThrow();
  });

  it('readInstanceConfig() delegates to fleetConfig', async () => {
    const cfg = await backend.readInstanceConfig('openclaw-1');
    expect(mockFleetConfig.readInstanceConfig).toHaveBeenCalledWith(1);
    expect(cfg).toEqual({ gateway: {} });
  });

  it('writeInstanceConfig() delegates to fleetConfig', async () => {
    await backend.writeInstanceConfig('openclaw-1', { gateway: { port: 18789 } });
    expect(mockFleetConfig.writeInstanceConfig).toHaveBeenCalledWith(1, { gateway: { port: 18789 } });
  });

  it('refresh() returns FleetStatus with mode=docker', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'abc', state: 'running' },
    ]);
    const status = await backend.refresh();
    expect(status.mode).toBe('docker');
    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('openclaw-1');
    expect(status.instances[0].index).toBe(1);
  });

  it('getCachedStatus() returns the last refresh result', async () => {
    await backend.refresh();
    expect(backend.getCachedStatus()).not.toBeNull();
    expect(backend.getCachedStatus()?.mode).toBe('docker');
  });
});
