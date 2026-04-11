import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { sessionRoutes } from '../../src/routes/sessions.js';

vi.mock('../../src/services/openclaw-client.js', () => ({
  fetchInstanceSessions: vi.fn().mockResolvedValue([
    {
      key: 'main',
      derivedTitle: 'Refactor auth',
      status: 'running',
      startedAt: Date.now() - 120_000,
      model: 'claude-opus-4',
      lastMessagePreview: 'Updated auth.ts.',
      totalTokens: 5000,
      estimatedCostUsd: 0.15,
      updatedAt: Date.now() - 10_000,
    },
  ]),
}));

const mockInstance = {
  id: 'openclaw-1', mode: 'docker' as const, index: 1, status: 'running' as const,
  port: 18789, token: 'tok***', uptime: 0, cpu: 0,
  memory: { used: 0, limit: 0 }, disk: { config: 0, workspace: 0 },
  health: 'healthy' as const, image: 'openclaw:local',
};

const stoppedInstance = { ...mockInstance, id: 'openclaw-2', status: 'stopped' as const };

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue({
    instances: [mockInstance, stoppedInstance],
    totalRunning: 1,
    updatedAt: Date.now(),
  }),
  revealToken: vi.fn().mockResolvedValue('full-gateway-token'),
};

describe('GET /api/fleet/sessions', () => {
  describe('as admin', () => {
    const app = Fastify();

    beforeAll(async () => {
      app.decorate('backend', mockBackend);
      app.addHook('onRequest', async (request) => {
        (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
      });
      await app.register(sessionRoutes);
      await app.ready();
    });

    afterAll(() => app.close());

    it('returns 200 with aggregated sessions from running instances only', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[] }[]; updatedAt: number }>();
      expect(body.updatedAt).toBeGreaterThan(0);
      // Only the running instance (openclaw-1) is fetched; stopped one is skipped
      expect(body.instances).toHaveLength(1);
      expect(body.instances[0].instanceId).toBe('openclaw-1');
      expect(body.instances[0].sessions).toHaveLength(1);
    });

    it('revealToken is called only for the running instance', async () => {
      mockBackend.revealToken.mockClear();
      await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(mockBackend.revealToken).toHaveBeenCalledOnce();
      expect(mockBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
    });

    it('returns instance with error when fetchInstanceSessions rejects', async () => {
      const { fetchInstanceSessions } = await import('../../src/services/openclaw-client.js');
      (fetchInstanceSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection refused'));
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[]; error?: string }[] }>();
      expect(body.instances[0].instanceId).toBe('openclaw-1');
      expect(body.instances[0].sessions).toEqual([]);
      expect(body.instances[0].error).toContain('connection refused');
    });

    it('returns error string when fetchInstanceSessions rejects with non-Error value', async () => {
      const { fetchInstanceSessions } = await import('../../src/services/openclaw-client.js');
      (fetchInstanceSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce('plain string error');
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[]; error?: string }[] }>();
      expect(body.instances[0].sessions).toEqual([]);
      expect(body.instances[0].error).toContain('plain string error');
    });

    it('returns empty instances when no running instances', async () => {
      mockBackend.getCachedStatus.mockReturnValueOnce({ instances: [stoppedInstance], totalRunning: 0, updatedAt: Date.now() });
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ instances: unknown[] }>().instances).toEqual([]);
    });

    it('returns empty instances when getCachedStatus is null', async () => {
      mockBackend.getCachedStatus.mockReturnValueOnce(null);
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ instances: unknown[] }>().instances).toEqual([]);
    });

    it('passes through token and cost fields from fetchInstanceSessions', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: { totalTokens?: number; estimatedCostUsd?: number; updatedAt?: number }[] }[] }>();
      const session = body.instances[0].sessions[0];
      expect(session.totalTokens).toBe(5000);
      expect(session.estimatedCostUsd).toBe(0.15);
      expect(session.updatedAt).toBeGreaterThan(0);
    });
  });

  describe('as non-admin', () => {
    const app = Fastify();

    beforeAll(async () => {
      app.decorate('backend', mockBackend);
      app.addHook('onRequest', async (request) => {
        (request as any).user = { username: 'alice', role: 'user', assignedProfiles: [] };
      });
      await app.register(sessionRoutes);
      await app.ready();
    });

    afterAll(() => app.close());

    it('returns 403', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(403);
    });
  });
});
