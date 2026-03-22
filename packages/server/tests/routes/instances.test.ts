import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const mockInstance = {
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
};

const mockMonitor = {
  refresh: vi.fn().mockResolvedValue({
    instances: [mockInstance],
    totalRunning: 1,
    updatedAt: Date.now(),
  }),
};

const mockDocker = {
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  restartContainer: vi.fn(),
};

const mockFleetConfig = {
  readTokens: vi.fn().mockReturnValue({ 1: 'full-token-abc123def456' }),
};

describe('Instance routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor);
    app.decorate('docker', mockDocker);
    app.decorate('fleetConfig', mockFleetConfig);
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/:id/start starts container and returns instance', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.startContainer).toHaveBeenCalledWith('openclaw-1');
    expect(res.json().instance.id).toBe('openclaw-1');
  });

  it('POST /api/fleet/:id/stop stops container', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/restart restarts container', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/restart' });
    expect(res.statusCode).toBe(200);
    expect(mockDocker.restartContainer).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/token/reveal returns full token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBe('full-token-abc123def456');
  });

  it('rejects invalid instance id on start', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/evil-container/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });

  it('rejects invalid instance id on stop', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/my-redis-container/stop' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });

  it('rejects invalid instance id on token reveal', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/my-container/token/reveal' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
