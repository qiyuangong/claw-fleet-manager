// packages/server/tests/routes/instances.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const mockInstance = {
  id: 'openclaw-1', index: 1, status: 'running', port: 18789, token: 'abc1***f456',
  uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
  health: 'healthy', image: 'openclaw:local',
};

const mockFleetStatus = { mode: 'docker' as const, instances: [mockInstance], totalRunning: 1, updatedAt: Date.now() };

const mockBackend = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(mockFleetStatus),
  revealToken: vi.fn().mockResolvedValue('full-token-abc123def456'),
  execInstanceCommand: vi.fn().mockResolvedValue(''),
};

describe('Instance routes — docker mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('POST /api/fleet/:id/start calls backend.start', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('openclaw-1');
    expect(res.json().instance.id).toBe('openclaw-1');
  });

  it('POST /api/fleet/:id/stop calls backend.stop', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.stop).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/restart calls backend.restart', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/restart' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.restart).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/token/reveal returns token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBe('full-token-abc123def456');
  });

  it('accepts named docker instance ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/team-alpha/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('team-alpha');
  });

  it('rejects invalid docker instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/BAD_ID/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});

describe('Instance routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('accepts profile name as instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/main/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('main');
  });

  it('rejects docker-style id in profile mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
