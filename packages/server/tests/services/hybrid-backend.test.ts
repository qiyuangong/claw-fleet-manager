import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { HybridBackend } from '../../src/services/hybrid-backend.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  unlinkSync: vi.fn(),
}));

const openclawCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: true,
  sessions: true,
  plugins: true,
  runtimeAdmin: true,
} as const;

const hermesCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
} as const;

describe('HybridBackend', () => {
  const dockerInstance = {
    id: 'openclaw-1',
    runtime: 'openclaw' as const,
    mode: 'docker' as const,
    runtimeCapabilities: openclawCapabilities,
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
    runtime: 'openclaw' as const,
    mode: 'profile' as const,
    runtimeCapabilities: openclawCapabilities,
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
  const hermesDockerInstance = {
    id: 'hermes-lab',
    runtime: 'hermes' as const,
    mode: 'docker' as const,
    runtimeCapabilities: hermesCapabilities,
    index: 2,
    status: 'running' as const,
    port: 0,
    token: 'masked',
    uptime: 100,
    cpu: 1,
    memory: { used: 1, limit: 2 },
    disk: { config: 1, workspace: 2 },
    health: 'healthy' as const,
    image: 'hermes:local',
  };
  const hermesProfileInstance = {
    id: 'research-bot',
    runtime: 'hermes' as const,
    mode: 'profile' as const,
    runtimeCapabilities: hermesCapabilities,
    status: 'running' as const,
    port: 0,
    token: 'masked',
    uptime: 100,
    cpu: 1,
    memory: { used: 1, limit: 2 },
    disk: { config: 1, workspace: 2 },
    health: 'healthy' as const,
    image: 'hermes:local',
    profile: 'research-bot',
    pid: 5252,
  };

  const dockerBackend = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getCachedStatus: vi.fn(),
    refresh: vi.fn(),
    createInstance: vi.fn(),
    removeInstance: vi.fn(),
    renameInstance: vi.fn(),
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
    renameInstance: vi.fn(),
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

  const hermesDockerBackend = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getCachedStatus: vi.fn(),
    refresh: vi.fn(),
    createInstance: vi.fn(),
    removeInstance: vi.fn(),
    renameInstance: vi.fn(),
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

  const hermesProfileBackend = {
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    getCachedStatus: vi.fn(),
    refresh: vi.fn(),
    createInstance: vi.fn(),
    removeInstance: vi.fn(),
    renameInstance: vi.fn(),
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

  const userService = {
    renameAssignedProfile: vi.fn().mockResolvedValue(undefined),
  };

  let backend: HybridBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerBackend.getCachedStatus.mockReturnValue({
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: 1000,
    });
    profileBackend.getCachedStatus.mockReturnValue({
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    hermesDockerBackend.getCachedStatus.mockReturnValue({
      instances: [hermesDockerInstance],
      totalRunning: 1,
      updatedAt: 3000,
    });
    hermesProfileBackend.getCachedStatus.mockReturnValue({
      instances: [hermesProfileInstance],
      totalRunning: 1,
      updatedAt: 4000,
    });
    dockerBackend.refresh.mockResolvedValue(dockerBackend.getCachedStatus());
    profileBackend.refresh.mockResolvedValue(profileBackend.getCachedStatus());
    hermesDockerBackend.refresh.mockResolvedValue(hermesDockerBackend.getCachedStatus());
    hermesProfileBackend.refresh.mockResolvedValue(hermesProfileBackend.getCachedStatus());
    dockerBackend.createInstance.mockResolvedValue(dockerInstance);
    profileBackend.createInstance.mockResolvedValue(profileInstance);
    hermesDockerBackend.createInstance.mockResolvedValue(hermesDockerInstance);
    hermesProfileBackend.createInstance.mockResolvedValue(hermesProfileInstance);
    backend = new HybridBackend({
      openclawDocker: dockerBackend as any,
      openclawProfile: profileBackend as any,
      hermesDocker: hermesDockerBackend as any,
      hermesProfile: hermesProfileBackend as any,
    }, userService as any);
  });

  it('refresh merges all runtime and mode backends into one fleet', async () => {
    const status = await backend.refresh();

    expect(status.instances.map((instance) => instance.id)).toEqual([
      'hermes-lab',
      'openclaw-1',
      'research-bot',
      'team-alpha',
    ]);
    expect(status.totalRunning).toBe(4);
    expect(status.updatedAt).toBe(4000);
  });

  it('createInstance dispatches by runtime and kind', async () => {
    await backend.createInstance({ runtime: 'openclaw', kind: 'docker', name: 'openclaw-2' });
    await backend.createInstance({ runtime: 'openclaw', kind: 'profile', name: 'team-beta' });
    await backend.createInstance({ runtime: 'hermes', kind: 'docker', name: 'hermes-lab-2' });
    await backend.createInstance({ runtime: 'hermes', kind: 'profile', name: 'research-bot-2' });

    expect(dockerBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'docker',
      name: 'openclaw-2',
    });
    expect(profileBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'profile',
      name: 'team-beta',
    });
    expect(hermesDockerBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'hermes',
      kind: 'docker',
      name: 'hermes-lab-2',
    });
    expect(hermesProfileBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot-2',
    });
  });

  it('rejects createInstance when the requested id already exists in another backend', async () => {
    await expect(backend.createInstance({ runtime: 'hermes', kind: 'docker', name: 'team-alpha' })).rejects.toThrow(/already exists/i);
    expect(hermesDockerBackend.createInstance).not.toHaveBeenCalled();
  });

  it('routes instance operations by runtime and mode', async () => {
    await backend.start('openclaw-1');
    await backend.stop('team-alpha');
    await backend.restart('hermes-lab');
    await backend.start('research-bot');

    expect(dockerBackend.start).toHaveBeenCalledWith('openclaw-1');
    expect(profileBackend.stop).toHaveBeenCalledWith('team-alpha');
    expect(hermesDockerBackend.restart).toHaveBeenCalledWith('hermes-lab');
    expect(hermesProfileBackend.start).toHaveBeenCalledWith('research-bot');
  });

  it('renameInstance routes to the owning backend, rewrites assignments, and returns the refreshed instance', async () => {
    const renamedDockerInstance = {
      ...dockerInstance,
      id: 'team-renamed',
    };
    dockerBackend.renameInstance.mockResolvedValue(renamedDockerInstance);
    dockerBackend.getCachedStatus
      .mockReturnValueOnce({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: 1000,
      })
      .mockReturnValueOnce({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: 1000,
      })
      .mockReturnValue({
        instances: [renamedDockerInstance],
        totalRunning: 1,
        updatedAt: 3000,
      });
    dockerBackend.refresh
      .mockResolvedValueOnce({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: 2000,
      })
      .mockResolvedValueOnce({
        instances: [renamedDockerInstance],
        totalRunning: 1,
        updatedAt: 3000,
      });
    profileBackend.getCachedStatus.mockReturnValue({
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    profileBackend.refresh
      .mockResolvedValueOnce({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: 2000,
      })
      .mockResolvedValueOnce({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: 2000,
      });

    const renamed = await backend.renameInstance('openclaw-1', 'team-renamed');

    expect(dockerBackend.renameInstance).toHaveBeenCalledWith('openclaw-1', 'team-renamed');
    expect(profileBackend.renameInstance).not.toHaveBeenCalled();
    expect(userService.renameAssignedProfile).toHaveBeenCalledWith('openclaw-1', 'team-renamed');
    expect(renamed.id).toBe('team-renamed');
  });

  it('renameInstance rejects same-name renames cleanly', async () => {
    await expect(backend.renameInstance('openclaw-1', 'openclaw-1')).rejects.toThrow(/same name/i);

    expect(dockerBackend.renameInstance).not.toHaveBeenCalled();
    expect(userService.renameAssignedProfile).not.toHaveBeenCalled();
  });

  it('renameInstance rejects cross-backend name collisions', async () => {
    await expect(backend.renameInstance('openclaw-1', 'team-alpha')).rejects.toThrow(/already exists/i);

    expect(dockerBackend.renameInstance).not.toHaveBeenCalled();
    expect(profileBackend.renameInstance).not.toHaveBeenCalled();
    expect(userService.renameAssignedProfile).not.toHaveBeenCalled();
  });

  it('renameInstance refreshes before checking cross-backend collisions', async () => {
    const freshProfileCollision = {
      ...profileInstance,
      id: 'team-fresh',
      profile: 'team-fresh',
    };

    dockerBackend.getCachedStatus.mockReturnValue({
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: 1000,
    });
    profileBackend.getCachedStatus.mockReturnValue({
      instances: [],
      totalRunning: 0,
      updatedAt: 1000,
    });
    dockerBackend.refresh.mockResolvedValue({
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    profileBackend.refresh.mockResolvedValue({
      instances: [freshProfileCollision],
      totalRunning: 1,
      updatedAt: 2000,
    });

    await expect(backend.renameInstance('openclaw-1', 'team-fresh')).rejects.toThrow(/already exists/i);

    expect(dockerBackend.renameInstance).not.toHaveBeenCalled();
    expect(profileBackend.renameInstance).not.toHaveBeenCalled();
    expect(userService.renameAssignedProfile).not.toHaveBeenCalled();
  });

  it('renameInstance attempts backend rollback when assignment rewrite fails', async () => {
    const renamedDockerInstance = {
      ...dockerInstance,
      id: 'team-renamed',
    };

    dockerBackend.renameInstance
      .mockResolvedValueOnce(renamedDockerInstance)
      .mockResolvedValueOnce(dockerInstance);
    userService.renameAssignedProfile.mockRejectedValueOnce(new Error('assignment write failed'));
    dockerBackend.getCachedStatus.mockReturnValue({
      instances: [dockerInstance],
      totalRunning: 1,
      updatedAt: 1000,
    });
    profileBackend.getCachedStatus.mockReturnValue({
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    dockerBackend.refresh
      .mockResolvedValueOnce({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: 2000,
      })
      .mockResolvedValueOnce({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: 3000,
      });
    profileBackend.refresh
      .mockResolvedValueOnce({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: 2000,
      })
      .mockResolvedValueOnce({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: 3000,
      });

    await expect(backend.renameInstance('openclaw-1', 'team-renamed')).rejects.toThrow(/assignment write failed/i);

    expect(dockerBackend.renameInstance).toHaveBeenNthCalledWith(1, 'openclaw-1', 'team-renamed');
    expect(dockerBackend.renameInstance).toHaveBeenNthCalledWith(2, 'team-renamed', 'openclaw-1');
  });

  it('initialize tolerates openclaw docker backend initialization failure when other backends are available', async () => {
    dockerBackend.initialize.mockRejectedValueOnce(new Error('docker unavailable'));

    await expect(backend.initialize()).resolves.toBeUndefined();
    expect(profileBackend.initialize).toHaveBeenCalled();
    expect(backend.getCachedStatus()?.instances.map((instance) => instance.id)).toEqual([
      'hermes-lab',
      'openclaw-1',
      'research-bot',
      'team-alpha',
    ]);
  });

  it('refresh falls back to cached profile status when openclaw docker refresh fails', async () => {
    dockerBackend.getCachedStatus.mockReturnValue(null);
    profileBackend.getCachedStatus.mockReturnValue({
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 2000,
    });
    hermesDockerBackend.getCachedStatus.mockReturnValue(null);
    hermesProfileBackend.getCachedStatus.mockReturnValue(null);
    dockerBackend.refresh.mockRejectedValueOnce(new Error('docker unavailable'));
    profileBackend.refresh.mockResolvedValueOnce({
      instances: [profileInstance],
      totalRunning: 1,
      updatedAt: 3000,
    });
    hermesDockerBackend.refresh.mockRejectedValueOnce(new Error('hermes docker unavailable'));
    hermesProfileBackend.refresh.mockRejectedValueOnce(new Error('hermes profile unavailable'));

    const status = await backend.refresh();

    expect(status.instances).toEqual([profileInstance]);
    expect(status.updatedAt).toBe(3000);
  });

  describe('migrate', () => {
    const migratedProfileInstance = {
      ...profileInstance,
      id: 'openclaw-1',
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
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      profileBackend.getCachedStatus.mockReturnValue({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      hermesDockerBackend.getCachedStatus.mockReturnValue({
        instances: [hermesDockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      hermesProfileBackend.getCachedStatus.mockReturnValue({
        instances: [hermesProfileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      dockerBackend.refresh.mockResolvedValue({
        instances: [dockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      profileBackend.refresh.mockResolvedValue({
        instances: [profileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      hermesDockerBackend.refresh.mockResolvedValue({
        instances: [hermesDockerInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      hermesProfileBackend.refresh.mockResolvedValue({
        instances: [hermesProfileInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
      dockerBackend.stop.mockResolvedValue(undefined);
      dockerBackend.revealToken.mockResolvedValue('plain-token');
      profileBackend.stop.mockResolvedValue(undefined);
      profileBackend.revealToken.mockResolvedValue('plain-token');
      dockerBackend.removeInstance.mockResolvedValue(undefined);
      profileBackend.removeInstance.mockResolvedValue(undefined);
      backend = new HybridBackend({
        openclawDocker: dockerBackend as any,
        openclawProfile: profileBackend as any,
        hermesDocker: hermesDockerBackend as any,
        hermesProfile: hermesProfileBackend as any,
      }, userService as any);
    });

    it('migrate() docker to profile stops container and calls profileBackend.createInstanceFromMigration', async () => {
      const result = await backend.migrate('openclaw-1', { targetMode: 'profile', deleteSource: true });

      expect(dockerBackend.stop).toHaveBeenCalledWith('openclaw-1');
      expect(dockerBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
      expect((profileBackend as any).createInstanceFromMigration).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'openclaw-1', token: 'plain-token' }),
      );
      expect(result.mode).toBe('profile');
    });

    it('migrate() docker to profile with deleteSource removes docker instance', async () => {
      await backend.migrate('openclaw-1', { targetMode: 'profile', deleteSource: true });

      expect(dockerBackend.removeInstance).toHaveBeenCalledWith('openclaw-1');
    });

    it('migrate() rejects docker to profile when deleteSource is false to avoid duplicate ids', async () => {
      await expect(backend.migrate('openclaw-1', { targetMode: 'profile', deleteSource: false }))
        .rejects.toThrow('deleteSource');

      expect((profileBackend as any).createInstanceFromMigration).not.toHaveBeenCalled();
      expect(dockerBackend.removeInstance).not.toHaveBeenCalled();
    });

    it('migrate() profile to docker stops profile and calls dockerBackend.createInstanceFromMigration', async () => {
      const result = await backend.migrate('team-alpha', { targetMode: 'docker', deleteSource: true });

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

    it('migrate() rejects Hermes runtime instances', async () => {
      await expect(backend.migrate('hermes-lab', { targetMode: 'profile', deleteSource: true }))
        .rejects.toThrow('Migration is not supported for runtime "hermes"');
    });

    it('migrate() throws when instance not found', async () => {
      await expect(backend.migrate('nonexistent', { targetMode: 'docker' })).rejects.toThrow('not found');
    });

    it('migrate() throws when instance is already in target mode', async () => {
      await expect(backend.migrate('openclaw-1', { targetMode: 'docker' })).rejects.toThrow('already in docker mode');
    });
  });
});
