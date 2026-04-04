import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { generateProxyToken, registerAuth } from '../../src/auth.js';
import { UserService } from '../../src/services/user.js';

let tmpDir: string;

function encode(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

const validAuth = `Basic ${encode('admin', 'secret1234')}`;

async function createUserService(username = 'admin', password = 'secret1234') {
  const dir = mkdtempSync(join(tmpdir(), 'auth-test-'));
  const service = new UserService(dir);
  await service.initialize({ username, password });
  return { dir, service };
}

describe('Auth middleware', () => {
  const app = Fastify();

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    const userService = new UserService(tmpDir);
    await userService.initialize({ username: 'admin', password: 'secret1234' });
    await registerAuth(app, userService);

    app.get('/api/test', async () => ({ ok: true }));
    app.get('/proxy/*', async () => ({ ok: true }));
    app.get('/proxy-ws/*', async () => ({ ok: true }));
    app.get('/ws/*', async () => ({ ok: true }));

    await app.ready();
  });

  afterAll(() => {
    app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows access with valid Basic Auth credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: validAuth } });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain(`x-fleet-proxy-auth=${encode('admin', 'secret1234')}`);
    expect(setCookie).toContain('Path=/proxy');
  });

  it('returns 401 without www-authenticate header on /api paths when auth is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('returns 401 without www-authenticate header on /api paths with wrong credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: `Basic ${encode('admin', 'wrong')}` } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('returns 401 with malformed base64 in Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: 'Basic %%%notbase64%%%' } });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when base64 decodes but has no colon separator', async () => {
    const noColon = Buffer.from('adminpassword').toString('base64');
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: `Basic ${noColon}` } });
    expect(res.statusCode).toBe(401);
  });

  it('suppresses www-authenticate header on /proxy/ paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/some-instance/' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('suppresses www-authenticate header on /proxy-ws/ paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy-ws/some-instance/' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('allows access via ?auth= query param on /proxy/ and sets cookie', async () => {
    const encoded = encode('admin', 'secret1234');
    const res = await app.inject({ method: 'GET', url: `/proxy/some-instance/?auth=${encoded}` });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string;
    expect(setCookie).toContain(`x-fleet-proxy-auth=${encoded}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/proxy');
  });

  it('allows access via cookie auth on /proxy/ paths', async () => {
    const encoded = encode('admin', 'secret1234');
    const res = await app.inject({ method: 'GET', url: '/proxy/some-instance/', headers: { cookie: `x-fleet-proxy-auth=${encoded}` } });
    expect(res.statusCode).toBe(200);
  });

  it('allows access via ?auth= query param on /ws/ paths', async () => {
    const encoded = encode('admin', 'secret1234');
    const res = await app.inject({ method: 'GET', url: `/ws/logs/openclaw-1?auth=${encoded}` });
    expect(res.statusCode).toBe(200);
  });

  it('allows access via proxyToken on /proxy/ paths without elevating a user session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/some-instance/?proxyToken=${generateProxyToken('some-instance')}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a proxyToken replayed against a different instance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/other-instance/?proxyToken=${generateProxyToken('some-instance')}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('does not allow proxyToken to authenticate /ws/ paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/ws/logs/openclaw-1?proxyToken=${generateProxyToken('openclaw-1')}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('returns 401 with wrong ?auth= credentials on proxy paths', async () => {
    const badEncoded = encode('admin', 'wrong');
    const res = await app.inject({ method: 'GET', url: `/proxy/some-instance/?auth=${badEncoded}` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('suppresses www-authenticate header on /ws/ paths when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/ws/logs/openclaw-1' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});

describe('auth rate limiting', () => {
  const app = Fastify();
  let tmpDirs: string[] = [];

  beforeAll(async () => {
    const { dir, service } = await createUserService();
    tmpDirs.push(dir);
    await registerAuth(app, service, { maxFailedAttempts: 3, windowMs: 60_000 });
    app.get('/api/probe', async () => ({ ok: true }));
    app.get('/proxy/*', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows requests with valid credentials before lockout', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/probe',
      headers: { authorization: `Basic ${encode('admin', 'secret1234')}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 429 after maxFailedAttempts bad passwords from the same IP', async () => {
    const badAuth = `Basic ${encode('admin', 'wrong')}`;
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/api/probe', headers: { authorization: badAuth } });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/probe',
      headers: { authorization: badAuth },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'Too many failed attempts', code: 'RATE_LIMITED' });
  });

  it('keeps the IP locked out even when credentials become valid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/probe',
      headers: { authorization: `Basic ${encode('admin', 'secret1234')}` },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});

describe('auth secure cookie', () => {
  const app = Fastify();
  let tmpDirs: string[] = [];

  beforeAll(async () => {
    const { dir, service } = await createUserService();
    tmpDirs.push(dir);
    await registerAuth(app, service, { secure: true });
    app.get('/proxy/*', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('marks the proxy cookie Secure when secure mode is enabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/some-instance/?auth=${encode('admin', 'secret1234')}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain('Secure');
  });
});
