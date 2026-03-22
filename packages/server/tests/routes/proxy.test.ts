import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { proxyRoutes, stripFrameHeaders } from '../../src/routes/proxy.js';

const mockStatus = {
  instances: [
    {
      id: 'openclaw-1',
      index: 1,
      port: 18789,
      status: 'running',
      token: 'abc1***f456',
      uptime: 100,
      cpu: 5,
      memory: { used: 200, limit: 8000 },
      disk: { config: 0, workspace: 0 },
      health: 'healthy',
      image: 'openclaw:local',
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockMonitor = { getStatus: vi.fn().mockReturnValue(mockStatus) };

describe('stripFrameHeaders', () => {
  it('removes X-Frame-Options entirely', () => {
    const result = stripFrameHeaders({ 'x-frame-options': 'DENY', 'content-type': 'text/html' });
    expect(result['x-frame-options']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('drops CSP entirely', () => {
    const result = stripFrameHeaders({
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
    });
    expect(result['content-security-policy']).toBeUndefined();
  });

  it('drops CSP even without frame-ancestors', () => {
    const result = stripFrameHeaders({
      'content-security-policy': "default-src 'self'",
    });
    expect(result['content-security-policy']).toBeUndefined();
  });

  it('strips hop-by-hop headers', () => {
    const result = stripFrameHeaders({ 'transfer-encoding': 'chunked', 'content-type': 'text/html' });
    expect(result['transfer-encoding']).toBeUndefined();
    expect(result['content-type']).toBe('text/html');
  });

  it('drops undefined values', () => {
    const result = stripFrameHeaders({ 'x-custom': undefined });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('Proxy routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor as any);
    await app.register(fastifyWebsocket);
    await app.register(proxyRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('returns 404 for unknown instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/openclaw-99/' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });

  it('matches the instance root path without a trailing slash', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/openclaw-99' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('INSTANCE_NOT_FOUND');
  });
});
