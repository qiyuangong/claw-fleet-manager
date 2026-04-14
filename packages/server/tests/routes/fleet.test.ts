// packages/server/tests/routes/fleet.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createInstanceSchema, fleetRoutes } from '../../src/routes/fleet.js';
import { profileRoutes } from '../../src/routes/profiles.js';

const mockStatus = {
  instances: [
    {
      id: 'openclaw-1',
      mode: 'docker' as const,
      runtime: 'openclaw' as const,
      index: 1,
      status: 'running',
      port: 18789,
      token: 'abc1***f456',
      uptime: 100,
      cpu: 12,
      memory: { used: 400, limit: 8000 },
      disk: { config: 0, workspace: 0 },
      health: 'healthy',
      image: 'openclaw:local',
      runtimeCapabilities: {
        configEditor: true,
        logs: true,
        rename: true,
        delete: true,
        proxyAccess: true,
        sessions: true,
        plugins: true,
        runtimeAdmin: true,
      },
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
  createInstance: vi.fn().mockResolvedValue(mockStatus.instances[0]),
  removeInstance: vi.fn().mockResolvedValue(undefined),
  renameInstance: vi.fn().mockResolvedValue({ ...mockStatus.instances[0], id: 'team-renamed' }),
};

describe('Fleet routes', () => {
  const app = Fastify();

  beforeEach(() => { vi.clearAllMocks(); mockBackend.getCachedStatus.mockReturnValue(mockStatus); });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet returns fleet status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().totalRunning).toBe(1);
  });

  it('GET /api/fleet includes runtime and runtimeCapabilities on each instance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    const [instance] = res.json().instances;
    expect(instance.runtime).toBe('openclaw');
    expect(instance.runtimeCapabilities.logs).toBe(true);
  });

  it('GET /api/fleet returns empty status when cache is null', async () => {
    mockBackend.getCachedStatus.mockReturnValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(0);
  });

  it('POST /api/fleet/scale is no longer exposed', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/fleet/instances creates a docker instance by name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'openclaw', kind: 'docker', name: 'team-alpha' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'docker',
      name: 'team-alpha',
    });
  });

  it('createInstanceSchema rejects unsupported Hermes profile payloads', () => {
    expect(createInstanceSchema.safeParse({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    }).success).toBe(false);

    expect(createInstanceSchema.safeParse({
      runtime: 'hermes',
      kind: 'docker',
      name: 'research-bot',
    }).success).toBe(true);
  });

  it('POST /api/fleet/instances rejects unsupported Hermes profile instances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'hermes', kind: 'profile', name: 'research-bot' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'Hermes profile instances are not supported',
      code: 'INVALID_BODY',
    });
    expect(mockBackend.createInstance).not.toHaveBeenCalled();
  });

  it('POST /api/fleet/instances passes docker overrides through to backend.createInstance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: {
        runtime: 'openclaw',
        kind: 'docker',
        name: 'team-beta',
        apiKey: 'sk-test',
        image: 'openclaw:latest',
        cpuLimit: '2',
        memoryLimit: '2G',
        portStep: 25,
        enableNpmPackages: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'docker',
      name: 'team-beta',
      apiKey: 'sk-test',
      image: 'openclaw:latest',
      cpuLimit: '2',
      memoryLimit: '2G',
      portStep: 25,
      enableNpmPackages: true,
    });
  });

  it('POST /api/fleet/instances creates a profile instance by name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'openclaw', kind: 'profile', name: 'rescue-team' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'profile',
      name: 'rescue-team',
    });
  });

  it('POST /api/fleet/instances returns 409 for docker name conflicts even when the message is sanitized', async () => {
    mockBackend.createInstance.mockRejectedValueOnce(new Error('Conflict. The container name "/openclaw-1" is already in use.'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'openclaw', kind: 'docker', name: 'team-alpha' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'An internal error occurred',
      code: 'CREATE_FAILED',
    });
  });

  it('DELETE /api/fleet/instances/:id removes a named docker instance', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/fleet/instances/team-alpha' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.removeInstance).toHaveBeenCalledWith('team-alpha');
  });

  it('POST /api/fleet/instances/:id/rename renames an instance', async () => {
    const renamed = { ...mockStatus.instances[0], id: 'team-renamed' };
    mockBackend.renameInstance.mockResolvedValueOnce(renamed);

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'team-renamed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(renamed);
    expect(mockBackend.renameInstance).toHaveBeenCalledWith('openclaw-1', 'team-renamed');
  });

  it('POST /api/fleet/instances/:id/rename rejects invalid target names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'Team Renamed' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: 'name must be lowercase alphanumeric with hyphens',
      code: 'INVALID_NAME',
    });
  });

  it('POST /api/fleet/instances/:id/rename maps backend conflicts to rename conflict errors', async () => {
    mockBackend.renameInstance.mockRejectedValueOnce(new Error('Instance "team-renamed" already exists'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'team-renamed' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "team-renamed" already exists',
      code: 'RENAME_CONFLICT',
    });
  });

  it('POST /api/fleet/instances/:id/rename maps stopped-instance errors to rename conflict errors', async () => {
    mockBackend.renameInstance.mockRejectedValueOnce(new Error('Instance "openclaw-1" must be stopped before it can be renamed'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'team-renamed' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "openclaw-1" must be stopped before it can be renamed',
      code: 'RENAME_CONFLICT',
    });
  });

  it('POST /api/fleet/instances/:id/rename maps missing instances to not found', async () => {
    mockBackend.renameInstance.mockRejectedValueOnce(new Error('Instance "openclaw-1" not found'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'team-renamed' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: 'Instance "openclaw-1" not found',
      code: 'INSTANCE_NOT_FOUND',
    });
  });

  it('POST /api/fleet/instances/:id/rename maps invalid profile names to invalid-name errors', async () => {
    mockBackend.renameInstance.mockRejectedValueOnce(new Error('"main" is reserved by standalone OpenClaw and cannot be managed as a fleet profile'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/rename',
      payload: { name: 'team-renamed' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: '"main" is reserved by standalone OpenClaw and cannot be managed as a fleet profile',
      code: 'INVALID_NAME',
    });
  });
});

describe('Fleet routes — hybrid validation', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', {
      getCachedStatus: vi.fn().mockReturnValue(null),
      createInstance: vi.fn().mockResolvedValue({ id: 'rescue' }),
      removeInstance: vi.fn().mockResolvedValue(undefined),
      renameInstance: vi.fn().mockResolvedValue({ id: 'rescue-renamed' }),
    });
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/instances validates profile names for profile instances', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'openclaw', kind: 'profile', name: 'main' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_NAME');
  });

  it('POST /api/fleet/instances requires kind', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances',
      payload: { runtime: 'openclaw', name: 'team-alpha' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_BODY');
  });
});

describe('Fleet routes — profile helper', () => {
  const app = Fastify();
  const mockBackend = {
    getCachedStatus: vi.fn().mockReturnValue(null),
    createInstance: vi.fn().mockResolvedValue({ id: 'rescue', mode: 'profile' }),
    removeInstance: vi.fn().mockResolvedValue(undefined),
    renameInstance: vi.fn().mockResolvedValue({ id: 'rescue-renamed', mode: 'profile' }),
  };

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(profileRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/profiles passes runtime through to backend.createInstance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/profiles',
      payload: { name: 'openclaw-research', port: 18801 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({
      runtime: 'openclaw',
      kind: 'profile',
      name: 'openclaw-research',
      port: 18801,
    });
  });
});
