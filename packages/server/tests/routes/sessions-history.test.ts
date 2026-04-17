import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionHistoryRoutes } from '../../src/routes/sessions-history.js';
import { SessionHistoryService } from '../../src/services/session-history.js';

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'session-history-route-'));
  const service = new SessionHistoryService({ dbPath: join(dir, 'sessions.sqlite') });
  return { dir, service };
}

describe('GET /api/fleet/sessions/history', () => {
  const { dir, service } = createService();
  const app = Fastify();

  beforeAll(async () => {
    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 10_000,
      sessions: [
        {
          key: 'run-1',
          status: 'running',
          derivedTitle: 'Alpha running',
          lastMessagePreview: 'match me',
        },
      ],
    });
    service.upsertSessions({
      instanceId: 'beta',
      seenAt: 20_000,
      sessions: [
        {
          key: 'done-1',
          status: 'done',
          derivedTitle: 'Beta done',
          lastMessagePreview: 'beta preview',
        },
      ],
    });

    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns grouped history rows plus updatedAt and totalEstimate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions/history' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      instances: [
        {
          instanceId: 'beta',
          sessions: [
            expect.objectContaining({
              key: 'done-1',
              status: 'done',
              updatedAt: 20_000,
            }),
          ],
        },
        {
          instanceId: 'alpha',
          sessions: [
            expect.objectContaining({
              key: 'run-1',
              status: 'running',
              updatedAt: 10_000,
            }),
          ],
        },
      ],
      updatedAt: expect.any(Number),
      totalEstimate: 2,
    });
  });

  it('applies filters and keyset pagination', async () => {
    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?status=done&limit=1',
    });
    const firstBody = firstPage.json<{ nextCursor?: string; instances: Array<{ instanceId: string; sessions: Array<{ key: string }> }> }>();

    expect(firstPage.statusCode).toBe(200);
    expect(firstBody.instances).toEqual([
      {
        instanceId: 'beta',
        sessions: [
          expect.objectContaining({ key: 'done-1' }),
        ],
      },
    ]);
    expect(firstBody.nextCursor).toBeUndefined();

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?from=5000&to=15000&status=active&q=match',
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json<{ instances: Array<{ instanceId: string; sessions: Array<{ key: string }> }> }>().instances).toEqual([
      {
        instanceId: 'alpha',
        sessions: [expect.objectContaining({ key: 'run-1' })],
      },
    ]);
  });

  it('returns 400 for invalid query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?limit=5001&status=bogus',
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 INVALID_QUERY for malformed cursor values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?cursor=definitely-not-a-cursor',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'INVALID_QUERY',
      error: 'Invalid cursor',
    });
  });
});

describe('GET /api/fleet/sessions/history auth and disabled cases', () => {
  it('returns 403 for non-admin users', async () => {
    const { dir, service } = createService();
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'alice', role: 'user', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions/history' });

    expect(res.statusCode).toBe(403);

    await app.close();
    service.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 404 when the route is not registered because history is disabled', async () => {
    const app = Fastify();
    const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions/history' });

    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
