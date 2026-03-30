import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { User } from '../../src/types.js';

const { undiciRequestMock } = vi.hoisted(() => ({
  undiciRequestMock: vi.fn(),
}));

vi.mock('undici', () => ({
  request: undiciRequestMock,
}));

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
    {
      id: 'openclaw-2',
      index: 2,
      port: 18809,
      status: 'running',
      token: 'abc1***f456',
      uptime: 120,
      cpu: 3,
      memory: { used: 180, limit: 8000 },
      disk: { config: 0, workspace: 0 },
      health: 'healthy',
      image: 'openclaw:local',
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockBackend = { getCachedStatus: vi.fn().mockReturnValue(mockStatus) };

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

  beforeEach(() => {
    undiciRequestMock.mockReset();
    mockBackend.getCachedStatus.mockReturnValue(mockStatus);
  });

  beforeAll(async () => {
    app.decorate('backend', mockBackend as any);
    app.decorate('fleetConfig', {
      readTokens: vi.fn().mockReturnValue({ 1: 'docker-token' }),
    } as any);
    app.addHook('onRequest', async (request) => {
      const username = request.headers['x-test-user'];
      if (typeof username !== 'string') {
        return;
      }

      const role = request.headers['x-test-role'] === 'admin' ? 'admin' : 'user';
      const assignedProfilesHeader = request.headers['x-test-profiles'];
      const assignedProfiles = typeof assignedProfilesHeader === 'string' && assignedProfilesHeader.length > 0
        ? assignedProfilesHeader.split(',').map((value) => value.trim()).filter(Boolean)
        : [];

      request.user = {
        username,
        passwordHash: 'ignored',
        role,
        assignedProfiles,
      } satisfies User;
    });
    await app.register(fastifyWebsocket);
    await app.register(proxyRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('injects bootstrap script for profile-mode HTML responses', async () => {
    mockBackend.getCachedStatus.mockReturnValue({
      instances: [
        {
          id: '1',
          profile: '1',
          port: 18789,
          status: 'running',
          token: '***',
          uptime: 100,
          cpu: 5,
          memory: { used: 200, limit: 8000 },
          disk: { config: 0, workspace: 0 },
          health: 'healthy',
          image: '/opt/homebrew/bin/openclaw',
        },
      ],
      totalRunning: 1,
      updatedAt: Date.now(),
    });
    mockBackend.revealToken = vi.fn().mockResolvedValue('profile-token');
    undiciRequestMock.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: Readable.from(['<html><head></head><body>ok</body></html>']),
    });

    const res = await app.inject({ method: 'GET', url: '/proxy/1/' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('profile-token');
    expect(res.body).toContain('window.WebSocket=P');
    expect(mockBackend.revealToken).toHaveBeenCalledWith('1');
  });

  it('returns 404 for unknown instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/openclaw-99/' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });

  it('forbids non-admin users from proxying unassigned instances', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/proxy/openclaw-2/',
      headers: {
        'x-test-user': 'alice',
        'x-test-role': 'user',
        'x-test-profiles': 'openclaw-1',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(undiciRequestMock).not.toHaveBeenCalled();
  });

  it('allows admins to proxy any instance', async () => {
    undiciRequestMock.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Readable.from(['{"ok":true}']),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/proxy/openclaw-2/',
      headers: {
        'x-test-user': 'admin',
        'x-test-role': 'admin',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(undiciRequestMock).toHaveBeenCalledWith(
      'http://127.0.0.1:18809/',
      expect.any(Object),
    );
  });

  it('matches the instance root path without a trailing slash', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/openclaw-99' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('INSTANCE_NOT_FOUND');
  });
});
