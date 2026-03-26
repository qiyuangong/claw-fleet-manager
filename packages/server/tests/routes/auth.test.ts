import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { registerAuth } from '../../src/auth.js';
import { UserService } from '../../src/services/user.js';

let tmpDir: string;

function encode(user: string, pass: string): string {
  return Buffer.from(`${user}:${pass}`).toString('base64');
}

const validAuth = `Basic ${encode('admin', 'secret1234')}`;

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
  });

  it('returns 401 with www-authenticate header when auth is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
    expect(res.json()).toEqual({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });

  it('returns 401 with wrong credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: `Basic ${encode('admin', 'wrong')}` } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
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

  it('returns 401 with wrong ?auth= credentials on proxy paths', async () => {
    const badEncoded = encode('admin', 'wrong');
    const res = await app.inject({ method: 'GET', url: `/proxy/some-instance/?auth=${badEncoded}` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('shows www-authenticate header on /ws/ paths when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/ws/logs/openclaw-1' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Basic realm="Claw Fleet Manager"');
  });
});
