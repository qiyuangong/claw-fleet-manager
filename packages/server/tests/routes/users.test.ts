import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { registerAuth } from '../../src/auth.js';
import { userRoutes } from '../../src/routes/users.js';
import { UserService } from '../../src/services/user.js';

function basic(user: string, pass: string) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

let tmpDir: string;
let svc: UserService;

describe('User routes', () => {
  const app = Fastify();

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'user-routes-'));
    svc = new UserService(tmpDir);
    await svc.initialize({ username: 'admin', password: 'adminpass1' });
    await svc.create('alice', 'alicepass1', 'user');

    await registerAuth(app, svc);
    app.decorate('userService', svc);
    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(() => {
    app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GET /api/users/me', () => {
    it('returns current user for admin', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: basic('admin', 'adminpass1') } });
      expect(res.statusCode).toBe(200);
      expect(res.json().username).toBe('admin');
      expect(res.json().role).toBe('admin');
      expect(res.json().passwordHash).toBeUndefined();
    });

    it('returns current user for regular user', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: basic('alice', 'alicepass1') } });
      expect(res.statusCode).toBe(200);
      expect(res.json().username).toBe('alice');
    });
  });

  describe('GET /api/users', () => {
    it('returns all users for admin', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: basic('admin', 'adminpass1') } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
      expect(res.json()[0].passwordHash).toBeUndefined();
    });

    it('returns 403 for regular user', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: basic('alice', 'alicepass1') } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/users', () => {
    it('admin can create a user', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: basic('admin', 'adminpass1') }, payload: { username: 'bob', password: 'bobspass1', role: 'user' } });
      expect(res.statusCode).toBe(201);
      expect(res.json().username).toBe('bob');
    });

    it('returns 409 on duplicate username', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: basic('admin', 'adminpass1') }, payload: { username: 'alice', password: 'alicepass1', role: 'user' } });
      expect(res.statusCode).toBe(409);
    });

    it('returns 400 on invalid username', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: basic('admin', 'adminpass1') }, payload: { username: 'BAD!!', password: 'password1', role: 'user' } });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for regular user', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/users', headers: { authorization: basic('alice', 'alicepass1') }, payload: { username: 'eve', password: 'password1', role: 'user' } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/users/:username', () => {
    it('admin can delete a non-admin user', async () => {
      await svc.create('todelete', 'password123', 'user');
      const res = await app.inject({ method: 'DELETE', url: '/api/users/todelete', headers: { authorization: basic('admin', 'adminpass1') } });
      expect(res.statusCode).toBe(200);
    });

    it('returns 403 when deleting last admin', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/users/admin', headers: { authorization: basic('admin', 'adminpass1') } });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 when admin tries to delete themselves (self-delete guard)', async () => {
      await svc.create('admin2', 'password123', 'admin');
      // admin tries to delete themselves — self-delete guard should fire before last-admin check
      const res = await app.inject({ method: 'DELETE', url: '/api/users/admin', headers: { authorization: basic('admin', 'adminpass1') } });
      expect(res.statusCode).toBe(403);
      // Clean up: have 'admin' delete 'admin2'
      await svc.delete('admin2', 'admin');
    });
  });

  describe('PUT /api/users/:username/password', () => {
    it('admin can reset any password', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/users/alice/password', headers: { authorization: basic('admin', 'adminpass1') }, payload: { password: 'newpassword1' } });
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 for short password', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/users/alice/password', headers: { authorization: basic('admin', 'adminpass1') }, payload: { password: 'short' } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/users/:username/profiles', () => {
    it('admin can set assigned profiles', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/users/alice/profiles', headers: { authorization: basic('admin', 'adminpass1') }, payload: { profiles: ['profile-a', 'profile-b'] } });
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 on invalid profile name', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/users/alice/profiles', headers: { authorization: basic('admin', 'adminpass1') }, payload: { profiles: ['INVALID!'] } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /api/users/me/password', () => {
    it('user can change own password with correct current password', async () => {
      // alice password was reset to newpassword1 above
      const res = await app.inject({ method: 'PUT', url: '/api/users/me/password', headers: { authorization: basic('alice', 'newpassword1') }, payload: { currentPassword: 'newpassword1', newPassword: 'updated1234' } });
      expect(res.statusCode).toBe(200);
    });

    it('returns 422 with wrong current password', async () => {
      const res = await app.inject({ method: 'PUT', url: '/api/users/me/password', headers: { authorization: basic('alice', 'updated1234') }, payload: { currentPassword: 'wrongpassword', newPassword: 'updated1234' } });
      expect(res.statusCode).toBe(422);
    });
  });
});
