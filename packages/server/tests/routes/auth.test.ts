import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { registerAuth } from '../../src/auth.js';
import type { ServerConfig } from '../../src/types.js';

const config: ServerConfig = {
  port: 3001,
  auth: { username: 'admin', password: 'secret' },
  fleetDir: '/tmp/fleet',
};

function encode(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

const validAuth = `Basic ${encode('admin', 'secret')}`;

describe('Auth middleware', () => {
  const app = Fastify();

  beforeAll(async () => {
    await registerAuth(app, config);

    // A simple test route for non-proxy paths
    app.get('/api/test', async () => ({ ok: true }));

    // Test routes for proxy paths
    app.get('/proxy/*', async () => ({ ok: true }));
    app.get('/proxy-ws/*', async () => ({ ok: true }));
    app.get('/ws/*', async () => ({ ok: true }));

    await app.ready();
  });

  afterAll(() => app.close());

  // 1. Valid Basic Auth allows access
  it('allows access with valid Basic Auth credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: validAuth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // 2. Missing auth returns 401 with www-authenticate header
  it('returns 401 with www-authenticate header when auth is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
    expect(res.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  // 3. Wrong credentials return 401
  it('returns 401 with wrong credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Basic ${encode('admin', 'wrong')}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
  });

  // 4. Malformed base64 returns 401
  it('returns 401 with malformed base64 in Authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: 'Basic %%%notbase64%%%' },
    });
    expect(res.statusCode).toBe(401);
  });

  // 5. Base64 without colon separator returns 401
  it('returns 401 when base64 decodes but has no colon separator', async () => {
    const noColon = Buffer.from('adminpassword').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Basic ${noColon}` },
    });
    expect(res.statusCode).toBe(401);
  });

  // 6. Proxy paths suppress www-authenticate header on 401
  it('suppresses www-authenticate header on /proxy/ paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/proxy/some-instance/',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('suppresses www-authenticate header on /proxy-ws/ paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/proxy-ws/some-instance/',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  // 7. Query auth on proxy paths works and sets HttpOnly SameSite=Strict cookie
  it('allows access via ?auth= query param on /proxy/ and sets cookie', async () => {
    const encoded = encode('admin', 'secret');
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/some-instance/?auth=${encoded}`,
    });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain(`x-fleet-proxy-auth=${encoded}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/proxy');
  });

  // 8. Cookie auth works on proxy paths
  it('allows access via cookie auth on /proxy/ paths', async () => {
    const encoded = encode('admin', 'secret');
    const res = await app.inject({
      method: 'GET',
      url: '/proxy/some-instance/',
      headers: { cookie: `x-fleet-proxy-auth=${encoded}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // 9. Query auth works on /ws/ paths
  it('allows access via ?auth= query param on /ws/ paths', async () => {
    const encoded = encode('admin', 'secret');
    const res = await app.inject({
      method: 'GET',
      url: `/ws/logs/openclaw-1?auth=${encoded}`,
    });
    expect(res.statusCode).toBe(200);
  });

  // 10. Wrong query auth on proxy paths returns 401
  it('returns 401 with wrong ?auth= credentials on proxy paths', async () => {
    const badEncoded = encode('admin', 'wrong');
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/some-instance/?auth=${badEncoded}`,
    });
    expect(res.statusCode).toBe(401);
    // Proxy paths suppress www-authenticate
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  // Additional: /ws/ paths still show www-authenticate (not suppressed)
  it('shows www-authenticate header on /ws/ paths when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ws/logs/openclaw-1',
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
  });
});
