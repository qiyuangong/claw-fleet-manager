// packages/server/tests/routes/fleet.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { fleetRoutes } from '../../src/routes/fleet.js';

const mockStatus = {
  mode: 'docker' as const,
  instances: [
    { id: 'openclaw-1', index: 1, status: 'running', port: 18789, token: 'abc1***f456',
      uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
      health: 'healthy', image: 'openclaw:local' },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
  scaleFleet: vi.fn().mockResolvedValue(mockStatus),
};

describe('Fleet routes', () => {
  const app = Fastify();

  beforeEach(() => { vi.clearAllMocks(); mockBackend.getCachedStatus.mockReturnValue(mockStatus); });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet returns fleet status with mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('docker');
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().totalRunning).toBe(1);
  });

  it('GET /api/fleet returns empty status when cache is null', async () => {
    mockBackend.getCachedStatus.mockReturnValue(null);
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(0);
  });

  it('POST /api/fleet/scale delegates to backend.scaleFleet', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    expect([200, 500]).toContain(res.statusCode);
    expect(mockBackend.scaleFleet).toHaveBeenCalledWith(3, '/tmp');
  });

  it('POST /api/fleet/scale validates count', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: -1 } });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/scale returns 409 when already scaling', async () => {
    let release: (() => void) | null = null;
    let started: (() => void) | null = null;
    const startedP = new Promise<void>((r) => { started = r; });

    mockBackend.scaleFleet.mockImplementationOnce(() => {
      started?.();
      return new Promise<typeof mockStatus>((r) => { release = () => r(mockStatus); });
    });

    const first = app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } });
    await startedP;
    const second = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    release?.();
    const firstRes = await first;

    expect(second.statusCode).toBe(409);
    expect(firstRes.statusCode).toBe(200);
  });
});

describe('Fleet routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', { getCachedStatus: vi.fn().mockReturnValue(null) });
    app.decorate('deploymentMode', 'profiles');
    app.decorate('fleetDir', '/tmp');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/scale returns 400 in profile mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('WRONG_MODE');
  });
});
