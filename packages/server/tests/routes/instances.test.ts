// packages/server/tests/routes/instances.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const mockInstance = {
  id: 'openclaw-1', mode: 'docker' as const, index: 1, status: 'running', port: 18789, token: 'abc1***f456',
  uptime: 100, cpu: 12, memory: { used: 400, limit: 8000 }, disk: { config: 0, workspace: 0 },
  health: 'healthy', image: 'openclaw:local',
};

const mockFleetStatus = { mode: 'hybrid' as const, instances: [mockInstance], totalRunning: 1, updatedAt: Date.now() };

const mockBackend = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(mockFleetStatus),
  revealToken: vi.fn().mockResolvedValue('full-token-abc123def456'),
  execInstanceCommand: vi.fn().mockResolvedValue(''),
};

describe('Instance routes — hybrid fleet', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'hybrid');
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

  it('POST /api/fleet/:id/token/reveal emits an audit log entry', async () => {
    const loggedMessages: object[] = [];
    const spy = vi.spyOn(app.log, 'info').mockImplementation((obj: unknown) => {
      if (obj && typeof obj === 'object') loggedMessages.push(obj as object);
    });

    await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });

    spy.mockRestore();
    const auditEntry = loggedMessages.find((m: any) => m.audit === true);
    expect(auditEntry).toBeDefined();
    expect((auditEntry as any).event).toBe('token_revealed');
    expect((auditEntry as any).instance).toBe('openclaw-1');
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
  it('accepts profile name as instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/main/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('main');
  });

  it('rejects malformed ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/BAD_ID/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
