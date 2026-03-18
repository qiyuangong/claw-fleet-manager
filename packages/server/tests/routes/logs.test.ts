import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { logRoutes } from '../../src/routes/logs.js';

describe('Log routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    const mockStream = { on: vi.fn(), destroy: vi.fn() };
    app.decorate('docker', {
      getContainerLogs: vi.fn().mockResolvedValue(mockStream),
      listFleetContainers: vi.fn().mockResolvedValue([]),
    });
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
});
