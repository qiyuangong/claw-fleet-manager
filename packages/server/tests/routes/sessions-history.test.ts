import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionHistoryRoutes } from '../../src/routes/sessions-history.js';
import { InvalidSessionHistoryCursorError } from '../../src/services/session-history-errors.js';
import type { SessionHistoryService } from '../../src/services/session-history.js';

describe('GET /api/fleet/sessions/history', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    while (apps.length > 0) {
      await apps.pop()?.close();
    }
  });

  it('returns grouped history rows plus updatedAt and totalEstimate', async () => {
    const service = {
      listSessions: vi.fn().mockReturnValue({
        instances: [
          {
            instanceId: 'beta',
            sessions: [{ key: 'done-1', status: 'done', updatedAt: 20_000 }],
          },
          {
            instanceId: 'alpha',
            sessions: [{ key: 'run-1', status: 'running', updatedAt: 10_000 }],
          },
        ],
      }),
      countSessions: vi.fn().mockReturnValue(2),
    };

    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service as SessionHistoryService }));
    await app.ready();

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
    expect(service.listSessions).toHaveBeenCalledWith({});
    expect(service.countSessions).toHaveBeenCalledWith({});
  });

  it('applies filters and keyset pagination', async () => {
    const service = {
      listSessions: vi.fn()
        .mockReturnValueOnce({
          instances: [
            {
              instanceId: 'beta',
              sessions: [{ key: 'done-1', status: 'done', updatedAt: 20_000 }],
            },
          ],
        })
        .mockReturnValueOnce({
          instances: [
            {
              instanceId: 'alpha',
              sessions: [{ key: 'run-1', status: 'running', updatedAt: 10_000 }],
            },
          ],
        }),
      countSessions: vi.fn().mockReturnValue(1),
    };

    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service as SessionHistoryService }));
    await app.ready();

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?status=done&limit=1',
    });
    const firstBody = firstPage.json<{ instances: Array<{ instanceId: string; sessions: Array<{ key: string }> }> }>();

    expect(firstPage.statusCode).toBe(200);
    expect(firstBody.instances).toEqual([
      {
        instanceId: 'beta',
        sessions: [
          expect.objectContaining({ key: 'done-1' }),
        ],
      },
    ]);

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
    expect(service.listSessions).toHaveBeenNthCalledWith(1, { status: 'done', limit: 1 });
    expect(service.listSessions).toHaveBeenNthCalledWith(2, {
      from: 5000,
      to: 15000,
      status: 'active',
      q: 'match',
    });
  });

  it('returns 400 for invalid query params', async () => {
    const service = {
      listSessions: vi.fn(),
      countSessions: vi.fn(),
    };

    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service as SessionHistoryService }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?limit=5001&status=bogus',
    });

    expect(res.statusCode).toBe(400);
    expect(service.listSessions).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_QUERY for malformed cursor values', async () => {
    const service = {
      listSessions: vi.fn().mockImplementation(() => {
        throw new InvalidSessionHistoryCursorError();
      }),
      countSessions: vi.fn(),
    };

    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, { sessionHistory: service as SessionHistoryService }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/fleet/sessions/history?cursor=definitely-not-a-cursor',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'INVALID_QUERY',
      error: 'Invalid cursor',
    });
    expect(service.countSessions).not.toHaveBeenCalled();
  });
});

describe('GET /api/fleet/sessions/history auth and disabled cases', () => {
  it('returns 403 for non-admin users', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'alice', role: 'user', assignedProfiles: [] };
    });
    await app.register((instance) => sessionHistoryRoutes(instance, {
      sessionHistory: {
        listSessions: vi.fn(),
        countSessions: vi.fn(),
      } as unknown as SessionHistoryService,
    }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions/history' });

    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('returns 404 when the route is not registered because history is disabled', async () => {
    const app = Fastify();
    const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions/history' });

    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
