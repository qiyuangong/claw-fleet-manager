import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { migrateRoutes } from '../../src/routes/migrate.js';

const migratedInstance = {
  id: 'openclaw-1',
  mode: 'profile' as const,
  status: 'running' as const,
  port: 18789,
  token: 'abc1***f456',
  uptime: 0,
  cpu: 0,
  memory: { used: 0, limit: 0 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy' as const,
  image: 'openclaw',
};

const mockBackend = {
  getCachedStatus: vi.fn(),
  migrate: vi.fn().mockResolvedValue(migratedInstance),
};

describe('Migrate routes', () => {
  const app = Fastify();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'hybrid');
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(migrateRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/instances/:id/migrate delegates to backend.migrate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.migrate).toHaveBeenCalledWith('openclaw-1', { targetMode: 'profile', deleteSource: false });
    expect(res.json().mode).toBe('profile');
  });

  it('POST /api/fleet/instances/:id/migrate passes deleteSource=true', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile', deleteSource: true },
    });
    expect(mockBackend.migrate).toHaveBeenCalledWith('openclaw-1', { targetMode: 'profile', deleteSource: true });
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 for non-hybrid mode', async () => {
    const app2 = Fastify();
    app2.decorate('backend', mockBackend);
    app2.decorate('deploymentMode', 'docker');
    app2.decorate('fleetDir', '/tmp');
    app2.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app2.register(migrateRoutes);
    await app2.ready();

    const res = await app2.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MODE_UNAVAILABLE');

    await app2.close();
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 for invalid targetMode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/instances/:id/migrate returns 404 when backend throws not found', async () => {
    mockBackend.migrate.mockRejectedValueOnce(new Error('Instance "openclaw-1" not found'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/fleet/instances/:id/migrate returns 400 when already in target mode', async () => {
    mockBackend.migrate.mockRejectedValueOnce(new Error('already in profile mode'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/instances/openclaw-1/migrate',
      payload: { targetMode: 'profile' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('ALREADY_TARGET_MODE');
  });
});
