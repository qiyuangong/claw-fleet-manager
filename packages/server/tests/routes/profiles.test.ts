// packages/server/tests/routes/profiles.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { profileRoutes } from '../../src/routes/profiles.js';

const mockInstance = {
  id: 'main',
  profile: 'main',
  status: 'running',
  port: 18789,
  token: 'abc1***f456',
  uptime: 100,
  cpu: 0,
  memory: { used: 0, limit: 0 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy',
  image: '/usr/local/bin/openclaw',
};

const mockBackend = {
  createInstance: vi.fn().mockResolvedValue(mockInstance),
  removeInstance: vi.fn().mockResolvedValue(undefined),
  getCachedStatus: vi.fn().mockReturnValue({
    mode: 'profiles',
    instances: [mockInstance],
    totalRunning: 1,
    updatedAt: Date.now(),
  }),
};

describe('Profile routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    await app.register(profileRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet/profiles returns instances', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/profiles' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().instances[0].id).toBe('main');
  });

  it('POST /api/fleet/profiles creates a profile', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/profiles',
      payload: { name: 'rescue', port: 19001 },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.createInstance).toHaveBeenCalledWith({ name: 'rescue', port: 19001, config: undefined });
    expect(res.json().id).toBe('main');
  });

  it('POST /api/fleet/profiles rejects missing name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/profiles',
      payload: { port: 19001 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/fleet/profiles/:name removes a profile', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/fleet/profiles/rescue' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.removeInstance).toHaveBeenCalledWith('rescue');
  });
});
