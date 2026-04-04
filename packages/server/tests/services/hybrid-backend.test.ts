import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HybridBackend } from '../../src/services/hybrid-backend.js';

describe('HybridBackend', () => {
  const dockerInstance = {
    id: 'openclaw-1',
    mode: 'docker' as const,
    index: 1,
    status: 'running' as const,
    port: 18789,
    token: 'masked',
    uptime: 100,
    cpu: 1,
    memory: { used: 1, limit: 2 },
    disk: { config: 1, workspace: 2 },
    health: 'healthy' as const,
    image: 'openclaw:local',
  };
  const profileInstance = {
    id: 'team-alpha',
    mode: 'profile' as const,
    status: 'running' as const,
    port: 18809,
    token: 'masked',
    uptime: 100,
    cpu: 1,
    memory: { used: 1, limit: 2 },
    disk: { config: 1, workspace: 2 },
    health: 'healthy' as const,
    image: 'openclaw:local',
    profile: 'team-alpha',
    pid: 4242,
  };

  const dockerBackend = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getCachedStatus: vi.fn(),
    refresh: vi.fn(),
    createInstance: vi.fn(),
    removeInstance: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    streamAllLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    execInstanceCommand: vi.fn(),
    revealToken: vi.fn(),
    readInstanceConfig: vi.fn(),
    writeInstanceConfig: vi.fn(),
  };

  const profileBackend = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getCachedStatus: vi.fn(),
    refresh: vi.fn(),
    createInstance: vi.fn(),
    removeInstance: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    streamAllLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    execInstanceCommand: vi.fn(),
    revealToken: vi.fn(),
    readInstanceConfig: vi.fn(),
    writeInstanceConfig: vi.fn(),
  };

  let backend: HybridBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerBackend.getCachedStatus.mockReturnValue({
      mode: 'docker',
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: 1000,
    });
    profileBackend.getCachedStatus.mockReturnValue({
      mode: 'profiles',
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    dockerBackend.refresh.mockResolvedValue(dockerBackend.getCachedStatus());
    profileBackend.refresh.mockResolvedValue(profileBackend.getCachedStatus());
    dockerBackend.createInstance.mockResolvedValue(dockerInstance);
    profileBackend.createInstance.mockResolvedValue(profileInstance);
    backend = new HybridBackend(dockerBackend as any, profileBackend as any);
  });

  it('refresh merges docker and profile instances into one hybrid fleet', async () => {
    const status = await backend.refresh();

    expect(status.mode).toBe('hybrid');
    expect(status.instances.map((instance) => instance.id)).toEqual(['openclaw-1', 'team-alpha']);
    expect(status.totalRunning).toBe(2);
    expect(status.updatedAt).toBe(2000);
  });

  it('createInstance dispatches by requested kind', async () => {
    await backend.createInstance({ kind: 'docker', name: 'openclaw-2' });
    await backend.createInstance({ kind: 'profile', name: 'team-beta' });

    expect(dockerBackend.createInstance).toHaveBeenCalledWith({ kind: 'docker', name: 'openclaw-2' });
    expect(profileBackend.createInstance).toHaveBeenCalledWith({ kind: 'profile', name: 'team-beta' });
  });

  it('rejects createInstance when the requested id already exists in the other backend', async () => {
    await expect(backend.createInstance({ kind: 'docker', name: 'team-alpha' })).rejects.toThrow(/already exists/i);
    expect(dockerBackend.createInstance).not.toHaveBeenCalled();
  });

  it('routes instance operations by the instance mode', async () => {
    await backend.start('openclaw-1');
    await backend.stop('team-alpha');

    expect(dockerBackend.start).toHaveBeenCalledWith('openclaw-1');
    expect(profileBackend.stop).toHaveBeenCalledWith('team-alpha');
  });

  it('initialize tolerates docker backend initialization failure when profiles are still available', async () => {
    dockerBackend.initialize.mockRejectedValueOnce(new Error('docker unavailable'));

    await expect(backend.initialize()).resolves.toBeUndefined();
    expect(profileBackend.initialize).toHaveBeenCalled();
    expect(backend.getCachedStatus()?.instances.map((instance) => instance.id)).toEqual(['openclaw-1', 'team-alpha']);
  });

  it('refresh falls back to cached profile status when docker refresh fails', async () => {
    dockerBackend.getCachedStatus.mockReturnValue(null);
    profileBackend.getCachedStatus.mockReturnValue({
      mode: 'profiles',
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    dockerBackend.refresh.mockRejectedValueOnce(new Error('docker unavailable'));
    profileBackend.refresh.mockResolvedValueOnce({
      mode: 'profiles',
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 3000,
    });

    const status = await backend.refresh();

    expect(status.mode).toBe('hybrid');
    expect(status.instances).toEqual([profileInstance]);
    expect(status.updatedAt).toBe(3000);
  });
});
