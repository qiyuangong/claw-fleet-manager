// packages/server/tests/routes/logs.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { logRoutes } from '../../src/routes/logs.js';

describe('Log routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', {
      streamLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
      streamAllLogs: vi.fn().mockReturnValue({ stop: vi.fn() }),
    });
    app.decorate('deploymentMode', 'docker');
    await app.register(fastifyWebsocket);
    await app.register(logRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('has /ws/logs/:id route registered', () => {
    const routes = app.printRoutes();
    expect(routes).toContain('ws/logs');
    expect(routes).toContain(':id');
  });

  it('has /ws/logs route registered', () => {
    const routes = app.printRoutes();
    expect(routes).toContain('ws/logs');
  });
});
