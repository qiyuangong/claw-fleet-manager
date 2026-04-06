import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { HybridBackend } from '../../src/services/hybrid-backend.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  unlinkSync: vi.fn(),
}));

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

  describe('migrate', () => {
    const migratedProfileInstance = {
      id: 'openclaw-1',
      mode: 'profile' as const,
      status: 'running' as const,
      port: 18789,
      token: 'masked',
      uptime: 10,
      cpu: 0,
      memory: { used: 0, limit: 0 },
      disk: { config: 0, workspace: 0 },
      health: 'healthy' as const,
      image: 'openclaw',
      profile: 'openclaw-1',
    };

    const migratedDockerInstance = {
      ...dockerInstance,
      id: 'team-alpha',
      mode: 'docker' as const,
    };

    beforeEach(() => {
      vi.clearAllMocks();

      (dockerBackend as any).createInstanceFromMigration = vi.fn().mockResolvedValue(migratedDockerInstance);
      (dockerBackend as any).getDockerConfigDir = vi.fn().mockReturnValue('/tmp/managed/openclaw-1/config');
      (dockerBackend as any).getDockerWorkspaceDir = vi.fn().mockReturnValue('/tmp/managed/openclaw-1/workspace');
      (profileBackend as any).createInstanceFromMigration = vi.fn().mockResolvedValue(migratedProfileInstance);
      (profileBackend as any).getInstanceDir = vi.fn().mockReturnValue({
        stateDir: '/tmp/states/team-alpha',
        configPath: '/tmp/states/team-alpha/openclaw.json',
      });

      dockerBackend.getCachedStatus.mockReturnValue({
        mode: 'docker',
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      profileBackend.getCachedStatus.mockReturnValue({
        mode: 'profiles',
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      dockerBackend.refresh.mockResolvedValue({
        mode: 'docker',
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      profileBackend.refresh.mockResolvedValue({
        mode: 'profiles',
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      dockerBackend.stop.mockResolvedValue(undefined);
      dockerBackend.revealToken.mockResolvedValue('plain-token');
      profileBackend.stop.mockResolvedValue(undefined);
      profileBackend.revealToken.mockResolvedValue('plain-token');
      dockerBackend.removeInstance.mockResolvedValue(undefined);
      profileBackend.removeInstance.mockResolvedValue(undefined);
      backend = new HybridBackend(dockerBackend as any, profileBackend as any);
    });

    it('migrate() docker to profile stops container and calls profileBackend.createInstanceFromMigration', async () => {
      const result = await (backend as any).migrate('openclaw-1', { targetMode: 'profile', deleteSource: true });

      expect(dockerBackend.stop).toHaveBeenCalledWith('openclaw-1');
      expect(dockerBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
      expect((profileBackend as any).createInstanceFromMigration).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'openclaw-1', token: 'plain-token' }),
      );
      expect(result.mode).toBe('profile');
    });

    it('migrate() docker to profile with deleteSource removes docker instance', async () => {
      await (backend as any).migrate('openclaw-1', { targetMode: 'profile', deleteSource: true });

      expect(dockerBackend.removeInstance).toHaveBeenCalledWith('openclaw-1');
    });

    it('migrate() rejects docker to profile when deleteSource is false to avoid duplicate ids', async () => {
      await expect((backend as any).migrate('openclaw-1', { targetMode: 'profile', deleteSource: false }))
        .rejects.toThrow('deleteSource');

      expect((profileBackend as any).createInstanceFromMigration).not.toHaveBeenCalled();
      expect(dockerBackend.removeInstance).not.toHaveBeenCalled();
    });

    it('migrate() profile to docker stops profile and calls dockerBackend.createInstanceFromMigration', async () => {
      const result = await (backend as any).migrate('team-alpha', { targetMode: 'docker', deleteSource: true });

      expect(profileBackend.stop).toHaveBeenCalledWith('team-alpha');
      expect(profileBackend.revealToken).toHaveBeenCalledWith('team-alpha');
      expect((dockerBackend as any).createInstanceFromMigration).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'team-alpha',
          token: 'plain-token',
          workspaceDir: join('/tmp/states/team-alpha', 'workspace'),
        }),
      );
      expect(result.mode).toBe('docker');
    });

    it('migrate() throws when instance not found', async () => {
      await expect((backend as any).migrate('nonexistent', { targetMode: 'docker' })).rejects.toThrow('not found');
    });

    it('migrate() throws when instance is already in target mode', async () => {
      await expect((backend as any).migrate('openclaw-1', { targetMode: 'docker' })).rejects.toThrow('already in docker mode');
    });
  });
});
