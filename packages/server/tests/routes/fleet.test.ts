import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { fleetRoutes } from '../../src/routes/fleet.js';

const mockStatus = {
  instances: [
    {
      id: 'openclaw-1',
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
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockMonitor = {
  getStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
};
const mockComposeGen = { generate: vi.fn() };
const mockDocker = {
  stopContainer: vi.fn(),
  listFleetContainers: vi.fn().mockResolvedValue([]),
};

describe('Fleet routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor);
    app.decorate('composeGenerator', mockComposeGen);
    app.decorate('docker', mockDocker);
    app.decorate('fleetDir', '/tmp');
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

  it('POST /api/fleet/scale validates count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/scale with valid count attempts compose apply', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: 3 },
    });
    expect([200, 500]).toContain(res.statusCode);
    expect(mockComposeGen.generate).toHaveBeenCalledWith(3);
  });
});
