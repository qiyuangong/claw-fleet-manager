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
      previewItems: [
        { role: 'user', text: 'Please refactor auth.ts.' },
        { role: 'assistant', text: 'Working on auth.ts now.' },
      ],
      totalTokens: 5000,
      estimatedCostUsd: 0.15,
      updatedAt: Date.now() - 10_000,
    },
    {
      key: 'done-1',
      derivedTitle: 'Done task',
      status: 'done',
      updatedAt: Date.now() - 40_000,
    },
  ]),
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

const openclawDockerInstance = {
  id: 'openclaw-1',
  runtime: 'openclaw' as const,
  mode: 'docker' as const,
  runtimeCapabilities: openclawCapabilities,
  index: 1,
  status: 'running' as const,
  port: 18789,
  token: 'tok***',
  uptime: 0,
  cpu: 0,
  memory: { used: 0, limit: 0 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy' as const,
  image: 'openclaw:local',
};

const openclawProfileInstance = {
  ...openclawDockerInstance,
  id: 'team-alpha',
  mode: 'profile' as const,
};

const hermesDockerInstance = {
  ...openclawDockerInstance,
  id: 'hermes-lab',
  runtime: 'hermes' as const,
  mode: 'docker' as const,
  runtimeCapabilities: hermesCapabilities,
};

const stoppedInstance = { ...openclawDockerInstance, id: 'openclaw-2', status: 'stopped' as const };

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue({
    instances: [
      openclawDockerInstance,
      openclawProfileInstance,
      hermesDockerInstance,
      stoppedInstance,
    ],
    totalRunning: 3,
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

    it('returns 200 with aggregated sessions from running instances that support sessions', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: unknown[] }[]; updatedAt: number }>();
      expect(body.updatedAt).toBeGreaterThan(0);
      expect(body.instances).toHaveLength(2);
      expect(body.instances.map((entry) => entry.instanceId)).toEqual(['openclaw-1', 'team-alpha']);
      expect(body.instances[0].sessions).toHaveLength(2);
    });

    it('revealToken is called only for running instances that support sessions', async () => {
      mockBackend.revealToken.mockClear();
      await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(mockBackend.revealToken).toHaveBeenCalledTimes(2);
      expect(mockBackend.revealToken).toHaveBeenCalledWith('openclaw-1');
      expect(mockBackend.revealToken).toHaveBeenCalledWith('team-alpha');
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

    it('returns empty instances when no running instances support sessions', async () => {
      mockBackend.getCachedStatus.mockReturnValueOnce({
        instances: [hermesDockerInstance, stoppedInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      });
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
      const body = res.json<{ instances: { instanceId: string; sessions: { totalTokens?: number; estimatedCostUsd?: number; updatedAt?: number; previewItems?: { role: string; text: string }[] }[] }[] }>();
      const session = body.instances[0].sessions[0];
      expect(session.totalTokens).toBe(5000);
      expect(session.estimatedCostUsd).toBe(0.15);
      expect(session.updatedAt).toBeGreaterThan(0);
      expect(session.previewItems).toHaveLength(2);
    });

    it('passes status and previewLimit through to fetchInstanceSessions', async () => {
      const { fetchInstanceSessions } = await import('../../src/services/openclaw-client.js');
      (fetchInstanceSessions as ReturnType<typeof vi.fn>).mockClear();

      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions?status=running&previewLimit=4' });
      expect(res.statusCode).toBe(200);

      expect(fetchInstanceSessions).toHaveBeenCalledWith(18789, 'full-gateway-token', 5000, {
        status: 'running',
        previewLimit: 4,
      });
    });

    it('filters response sessions by status query', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions?status=running' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { sessions: { key: string }[] }[] }>();
      expect(body.instances[0].sessions.map((session) => session.key)).toEqual(['main']);
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
