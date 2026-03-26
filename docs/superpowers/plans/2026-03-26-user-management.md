# User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-user support with admin/user roles, profile assignment, and self-service password change to the Claw Fleet Manager.

**Architecture:** A new `UserService` stores users in `users.json` (in `fleetDir`) with `crypto.scrypt` hashed passwords. The existing Basic Auth hook is updated to verify against `UserService` and attach `request.user`. New `requireAdmin` and `requireProfileAccess` preHandlers enforce role-based access on existing and new routes. The web UI adds a `UserManagementPanel` (admin-only), per-user instance filtering, and a `ChangePasswordDialog` accessible from a shell account indicator.

**Tech Stack:** Node.js `crypto` (scrypt), Zod (validation), Fastify preHandlers, React Query, Zustand

**Spec:** `docs/superpowers/specs/2026-03-26-user-management-design.md`

---

## File Map

### New files
- `packages/server/src/services/user.ts` — UserService (CRUD, verify, hash, cache)
- `packages/server/src/authorize.ts` — requireAdmin, requireProfileAccess preHandlers
- `packages/server/src/routes/users.ts` — /api/users/* routes
- `packages/server/tests/services/user.test.ts` — UserService unit tests
- `packages/server/tests/routes/users.test.ts` — User route tests
- `packages/web/src/api/users.ts` — API calls for user management
- `packages/web/src/hooks/useCurrentUser.ts` — GET /api/users/me hook
- `packages/web/src/hooks/useUsers.ts` — GET /api/users hook (admin)
- `packages/web/src/components/users/ChangePasswordDialog.tsx`
- `packages/web/src/components/users/UserManagementPanel.tsx`

### Modified files
- `packages/server/src/types.ts` — add User, PublicUser types
- `packages/server/src/fastify.d.ts` — add request.user, app.userService; remove proxyAuth
- `packages/server/src/auth.ts` — use userService.verify(), attach request.user
- `packages/server/src/index.ts` — wire UserService, remove proxyAuth
- `packages/server/src/routes/fleet.ts` — filter GET /api/fleet, requireAdmin on scale
- `packages/server/src/routes/instances.ts` — requireProfileAccess on all :id routes
- `packages/server/src/routes/logs.ts` — requireAdmin on /ws/logs, requireProfileAccess on /ws/logs/:id
- `packages/server/src/routes/config.ts` — requireAdmin on /api/config/fleet, requireProfileAccess on /api/fleet/:id/config
- `packages/server/src/routes/profiles.ts` — requireAdmin on create/delete, requireProfileAccess on plugins
- `packages/server/tests/routes/auth.test.ts` — update for multi-user verify
- `packages/web/src/types.ts` — add PublicUser
- `packages/web/src/store.ts` — add currentUser state
- `packages/web/src/components/layout/Shell.tsx` — account indicator, UserManagementPanel view
- `packages/web/src/components/layout/Sidebar.tsx` — Users nav entry, instance filtering

---

## Task 1: UserService — types and core

**Files:**
- Create: `packages/server/src/services/user.ts`
- Modify: `packages/server/src/types.ts`
- Create: `packages/server/tests/services/user.test.ts`

- [ ] **Step 1: Add types to `packages/server/src/types.ts`**

Append at the end of the file:

```typescript
export interface User {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}

export type PublicUser = Omit<User, 'passwordHash'>;
```

- [ ] **Step 2: Write failing tests for UserService**

Create `packages/server/tests/services/user.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UserService } from '../../src/services/user.js';

let tmpDir: string;
let svc: UserService;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'user-svc-test-'));
  svc = new UserService(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('UserService.initialize', () => {
  it('seeds users.json with admin from bootstrap credentials', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    const users = svc.list();
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].role).toBe('admin');
  });

  it('does not overwrite existing users.json on second call', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.initialize({ username: 'admin', password: 'newpassword' });
    expect(svc.list()).toHaveLength(2);
  });
});

describe('UserService.verify', () => {
  it('returns user on correct credentials', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    const user = await svc.verify('admin', 'password123');
    expect(user).not.toBeNull();
    expect(user?.username).toBe('admin');
  });

  it('returns null on wrong password', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    const user = await svc.verify('admin', 'wrong');
    expect(user).toBeNull();
  });

  it('returns null for unknown username without throwing', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    const user = await svc.verify('nobody', 'password123');
    expect(user).toBeNull();
  });
});

describe('UserService.create', () => {
  it('creates a user and returns PublicUser', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    const u = await svc.create('alice', 'password123', 'user');
    expect(u.username).toBe('alice');
    expect(u.role).toBe('user');
    expect((u as any).passwordHash).toBeUndefined();
  });

  it('throws on duplicate username', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await expect(svc.create('admin', 'password123', 'user')).rejects.toThrow(/already exists/);
  });

  it('throws on invalid username', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await expect(svc.create('INVALID!!', 'password123', 'user')).rejects.toThrow(/username/i);
  });

  it('throws on password shorter than 8 chars', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await expect(svc.create('alice', 'short', 'user')).rejects.toThrow(/password/i);
  });
});

describe('UserService.delete', () => {
  it('deletes a non-admin user', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.delete('alice', 'admin');
    expect(svc.list().find(u => u.username === 'alice')).toBeUndefined();
  });

  it('throws when deleting would leave zero admins', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await expect(svc.delete('admin', 'alice')).rejects.toThrow(/last admin/i);
  });

  it('throws when deleting self', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'admin');
    await expect(svc.delete('alice', 'alice')).rejects.toThrow(/self/i);
  });
});

describe('UserService.setPassword', () => {
  it('allows login with new password after admin reset', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.setPassword('admin', 'newpassword1');
    expect(await svc.verify('admin', 'newpassword1')).not.toBeNull();
    expect(await svc.verify('admin', 'password123')).toBeNull();
  });
});

describe('UserService.verifyAndSetPassword', () => {
  it('changes password when current password is correct', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.verifyAndSetPassword('admin', 'password123', 'newpassword1');
    expect(await svc.verify('admin', 'newpassword1')).not.toBeNull();
  });

  it('throws when current password is wrong', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await expect(svc.verifyAndSetPassword('admin', 'wrong', 'newpassword1')).rejects.toThrow(/current password/i);
  });
});

describe('UserService.setAssignedProfiles', () => {
  it('sets profiles on a user', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.setAssignedProfiles('alice', ['profile-a', 'profile-b']);
    expect(svc.get('alice')?.assignedProfiles).toEqual(['profile-a', 'profile-b']);
  });

  it('throws on invalid profile name', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await expect(svc.setAssignedProfiles('alice', ['INVALID!'])).rejects.toThrow(/invalid profile/i);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd packages/server && npx vitest run tests/services/user.test.ts
```

Expected: FAIL — `UserService` not found.

- [ ] **Step 4: Implement `packages/server/src/services/user.ts`**

```typescript
// packages/server/src/services/user.ts
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { User, PublicUser } from '../types.js';

const scryptAsync = promisify(scrypt);

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SCRYPT_KEYLEN = 64;
const CACHE_TTL_MS = 10_000;

interface CacheEntry { result: User | null; expiresAt: number }

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  const hash = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

function cacheKey(username: string, password: string): string {
  return createHash('sha256').update(`${username}:${password}`).digest('hex');
}

export class UserService {
  private usersFile: string;
  private users: User[] = [];
  private cache = new Map<string, CacheEntry>();
  private sentinelHash: string | null = null;

  constructor(fleetDir: string) {
    this.usersFile = join(fleetDir, 'users.json');
  }

  async initialize(bootstrap: { username: string; password: string }): Promise<void> {
    if (existsSync(this.usersFile)) {
      const data = JSON.parse(readFileSync(this.usersFile, 'utf-8'));
      this.users = data.users ?? [];
      return;
    }
    const passwordHash = await hashPassword(bootstrap.password);
    this.users = [{ username: bootstrap.username, passwordHash, role: 'admin', assignedProfiles: [] }];
    this.persist();
    // Pre-compute sentinel hash for timing-safe unknown-user verify
    this.sentinelHash = await hashPassword('sentinel-value-that-never-matches');
  }

  private async ensureSentinel(): Promise<string> {
    if (!this.sentinelHash) {
      this.sentinelHash = await hashPassword('sentinel-value-that-never-matches');
    }
    return this.sentinelHash;
  }

  async verify(username: string, password: string): Promise<User | null> {
    const key = cacheKey(username, password);
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;

    const user = this.users.find(u => u.username === username);
    let result: User | null = null;
    if (user) {
      const ok = await verifyPassword(password, user.passwordHash);
      result = ok ? user : null;
    } else {
      // Dummy verify for timing safety
      await verifyPassword(password, await this.ensureSentinel());
    }

    this.cache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  }

  list(): PublicUser[] {
    return this.users.map(({ passwordHash: _, ...rest }) => rest);
  }

  get(username: string): PublicUser | undefined {
    const u = this.users.find(u => u.username === username);
    if (!u) return undefined;
    const { passwordHash: _, ...rest } = u;
    return rest;
  }

  async create(username: string, password: string, role: 'admin' | 'user'): Promise<PublicUser> {
    if (!USERNAME_RE.test(username)) throw new Error('Invalid username: must match /^[a-z0-9][a-z0-9_-]{0,62}$/');
    if (password.length < 8) throw new Error('Invalid password: minimum 8 characters');
    if (this.users.find(u => u.username === username)) throw new Error(`User '${username}' already exists`);
    const passwordHash = await hashPassword(password);
    const user: User = { username, passwordHash, role, assignedProfiles: [] };
    this.users.push(user);
    this.persist();
    const { passwordHash: _, ...pub } = user;
    return pub;
  }

  async delete(username: string, requestingUsername: string): Promise<void> {
    if (username === requestingUsername) throw new Error('Cannot delete self');
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    const remaining = this.users.filter(u => u.username !== username);
    if (!remaining.some(u => u.role === 'admin')) throw new Error('Cannot delete the last admin');
    this.users = remaining;
    this.evictCacheForUser(username);
    this.persist();
  }

  async setPassword(username: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('Invalid password: minimum 8 characters');
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    user.passwordHash = await hashPassword(newPassword);
    this.evictCacheForUser(username);
    this.persist();
  }

  async verifyAndSetPassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new Error('Current password is incorrect');
    if (newPassword.length < 8) throw new Error('Invalid password: minimum 8 characters');
    user.passwordHash = await hashPassword(newPassword);
    this.evictCacheForUser(username);
    this.persist();
  }

  async setAssignedProfiles(username: string, profiles: string[]): Promise<void> {
    for (const p of profiles) {
      if (!PROFILE_NAME_RE.test(p)) throw new Error(`Invalid profile name: '${p}'`);
    }
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    user.assignedProfiles = profiles;
    this.persist();
  }

  private evictCacheForUser(username: string): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.result?.username === username) this.cache.delete(key);
    }
  }

  private persist(): void {
    const tmp = `${this.usersFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ users: this.users }, null, 2), 'utf-8');
    renameSync(tmp, this.usersFile);
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd packages/server && npx vitest run tests/services/user.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/types.ts packages/server/src/services/user.ts packages/server/tests/services/user.test.ts
git commit -m "feat: add UserService with scrypt hashing and verify cache"
```

---

## Task 2: Auth integration — wire UserService into auth hook

**Files:**
- Modify: `packages/server/src/fastify.d.ts`
- Modify: `packages/server/src/auth.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/tests/routes/auth.test.ts`

- [ ] **Step 1: Update `packages/server/src/fastify.d.ts`**

Replace the entire file:

```typescript
import type { DeploymentBackend } from './services/backend.js';
import type { FleetConfigService } from './services/fleet-config.js';
import type { UserService } from './services/user.js';
import type { User } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    backend: DeploymentBackend;
    deploymentMode: 'docker' | 'profiles';
    fleetConfig: FleetConfigService;
    fleetDir: string;
    userService: UserService;
  }
  interface FastifyRequest {
    user: User;
  }
}
```

- [ ] **Step 2: Update `packages/server/src/auth.ts`**

Replace `registerAuth` to accept `UserService` and use it. Replace the entire file:

```typescript
import { URL } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { UserService } from './services/user.js';

const PROXY_TOKEN_SECRET = randomBytes(32);
const PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateProxyToken(): string {
  const expires = Date.now() + PROXY_TOKEN_TTL_MS;
  const payload = String(expires);
  const sig = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function validateProxyToken(token: string): boolean {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expires = parseInt(payload, 10);
  if (isNaN(expires) || Date.now() > expires) return false;
  const expected = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function parseBasicAuth(header?: string): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function parseWebSocketQueryAuth(urlPath: string): { username: string; password: string } | null {
  try {
    const url = new URL(urlPath, 'http://localhost');
    const encoded = url.searchParams.get('auth');
    if (!encoded) return null;
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function parseProxyCookie(cookieHeader: string | undefined, cookieName: string): { username: string; password: string } | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${cookieName}=`)) {
      const encoded = trimmed.slice(cookieName.length + 1);
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return null;
        return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function registerAuth(app: FastifyInstance, userService: UserService) {
  const proxyCookieName = 'x-fleet-proxy-auth';

  app.addHook('onRequest', async (request, reply) => {
    const headerCredentials = parseBasicAuth(request.headers.authorization);
    if (headerCredentials) {
      const user = await userService.verify(headerCredentials.username, headerCredentials.password);
      if (user) {
        request.user = user;
        return;
      }
    }

    const rawUrl = request.raw.url ?? '/';
    const isProxyPath =
      rawUrl.startsWith('/ws/')
      || rawUrl.startsWith('/proxy/')
      || rawUrl.startsWith('/proxy-ws/');

    if (isProxyPath) {
      const cookieCredentials = parseProxyCookie(request.headers.cookie, proxyCookieName);
      if (cookieCredentials) {
        const user = await userService.verify(cookieCredentials.username, cookieCredentials.password);
        if (user) {
          request.user = user;
          return;
        }
      }

      const proxyToken = new URL(rawUrl, 'http://localhost').searchParams.get('proxyToken');
      if (proxyToken && validateProxyToken(proxyToken)) {
        // proxyToken path — token was issued server-side after a real auth; treat as admin-level.
        // We must set request.user to a synthetic admin-like object so that any preHandlers
        // (requireProfileAccess on /ws/logs/:id) don't 403 due to missing request.user.
        request.user = { username: '__proxytoken__', passwordHash: '', role: 'admin', assignedProfiles: [] };
        return;
      }

      const queryCredentials = parseWebSocketQueryAuth(rawUrl);
      if (queryCredentials) {
        const user = await userService.verify(queryCredentials.username, queryCredentials.password);
        if (user) {
          request.user = user;
          const encoded = rawUrl.match(/[?&]auth=([^&]*)/)?.[1] ?? '';
          if (encoded) {
            reply.header(
              'set-cookie',
              `${proxyCookieName}=${encoded}; Path=/proxy; HttpOnly; SameSite=Strict`,
            );
          }
          return;
        }
      }
    }

    const suppressBrowserPrompt =
      rawUrl.startsWith('/proxy/')
      || rawUrl.startsWith('/proxy-ws/');

    if (!suppressBrowserPrompt) {
      reply.header('www-authenticate', 'Basic realm="Claw Fleet Manager"');
    }
    return reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  });
}
```

- [ ] **Step 3: Update `packages/server/src/index.ts`**

Make three changes:
1. Import `UserService` at the top:
```typescript
import { UserService } from './services/user.js';
```

2. After `const fleetConfig = new FleetConfigService(config.fleetDir);`, add:
```typescript
const userService = new UserService(config.fleetDir);
await userService.initialize(config.auth);
```

3. Replace the `registerAuth` call and `proxyAuth` decoration section. Change:
```typescript
await registerAuth(app, config);
```
to:
```typescript
await registerAuth(app, userService);
```

4. Remove the `proxyAuth` decorator line:
```typescript
app.decorate('proxyAuth', Buffer.from(
  `${config.auth.username}:${config.auth.password}`, 'utf-8',
).toString('base64'));
```

5. Add after the other decorators:
```typescript
app.decorate('userService', userService);
```

- [ ] **Step 4: Update `packages/server/tests/routes/auth.test.ts`**

The test sets up auth with a `ServerConfig`. It needs to use `UserService` now. Replace the `beforeAll` setup to build a `UserService` and pass it to `registerAuth`:

```typescript
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
  });

  it('returns 401 with wrong credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test', headers: { authorization: `Basic ${encode('admin', 'wrong')}` } });
    expect(res.statusCode).toBe(401);
  });

  it('suppresses www-authenticate header on /proxy/ paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/some-instance/' });
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
  });

  it('allows access via cookie auth on /proxy/ paths', async () => {
    const encoded = encode('admin', 'secret1234');
    const res = await app.inject({ method: 'GET', url: '/proxy/some-instance/', headers: { cookie: `x-fleet-proxy-auth=${encoded}` } });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 with wrong ?auth= credentials on proxy paths', async () => {
    const res = await app.inject({ method: 'GET', url: `/proxy/some-instance/?auth=${encode('admin', 'wrong')}` });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run auth tests**

```bash
cd packages/server && npx vitest run tests/routes/auth.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run all server tests**

```bash
cd packages/server && npx vitest run
```

Expected: all existing tests pass (the auth signature changed; fleet/instances tests don't use auth, so they are unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/fastify.d.ts packages/server/src/auth.ts packages/server/src/index.ts packages/server/tests/routes/auth.test.ts
git commit -m "feat: integrate UserService into auth hook, attach request.user"
```

---

## Task 3: Authorization preHandlers

**Files:**
- Create: `packages/server/src/authorize.ts`

No dedicated test file — these are integration-tested via route tests in Tasks 4 and 5.

- [ ] **Step 1: Create `packages/server/src/authorize.ts`**

```typescript
// packages/server/src/authorize.ts
import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user || request.user.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}

export async function requireProfileAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
  if (request.user.role === 'admin') return;
  const id = (request.params as Record<string, string>).id;
  if (!id || !request.user.assignedProfiles.includes(id)) {
    return reply.status(403).send({ error: 'Forbidden', code: 'FORBIDDEN' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/authorize.ts
git commit -m "feat: add requireAdmin and requireProfileAccess preHandlers"
```

---

## Task 4: User routes

**Files:**
- Create: `packages/server/src/routes/users.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/tests/routes/users.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/server/tests/routes/users.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd packages/server && npx vitest run tests/routes/users.test.ts
```

Expected: FAIL — `userRoutes` not found.

- [ ] **Step 3: Create `packages/server/src/routes/users.ts`**

```typescript
// packages/server/src/routes/users.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const createUserSchema = z.object({
  username: z.string().regex(USERNAME_RE, 'username must be lowercase alphanumeric with underscores/hyphens'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  role: z.enum(['admin', 'user']),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'password must be at least 8 characters'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
});

const setProfilesSchema = z.object({
  profiles: z.array(z.string()),
});

export async function userRoutes(app: FastifyInstance) {
  // Self-service — registered BEFORE parametric /:username routes
  app.get('/api/users/me', async (request) => {
    const { passwordHash: _, ...pub } = request.user as any;
    return pub;
  });

  app.put('/api/users/me/password', async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.verifyAndSetPassword(
        request.user.username,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      return { ok: true };
    } catch (error: any) {
      if (error.message?.includes('incorrect')) {
        return reply.status(422).send({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
      }
      return reply.status(400).send({ error: error.message, code: 'PASSWORD_CHANGE_FAILED' });
    }
  });

  // Admin-only routes
  app.get('/api/users', { preHandler: requireAdmin }, async () => {
    return app.userService.list();
  });

  app.post('/api/users', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      const user = await app.userService.create(parsed.data.username, parsed.data.password, parsed.data.role);
      return reply.status(201).send(user);
    } catch (error: any) {
      const code = error.message?.includes('already exists') ? 409 : 400;
      return reply.status(code).send({ error: error.message, code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { username: string } }>('/api/users/:username', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      await app.userService.delete(request.params.username, request.user.username);
      return { ok: true };
    } catch (error: any) {
      const code = error.message?.includes('self') || error.message?.includes('last admin') ? 403 : 404;
      return reply.status(code).send({ error: error.message, code: 'DELETE_FAILED' });
    }
  });

  app.put<{ Params: { username: string } }>('/api/users/:username/password', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.setPassword(request.params.username, parsed.data.password);
      return { ok: true };
    } catch (error: any) {
      return reply.status(404).send({ error: error.message, code: 'USER_NOT_FOUND' });
    }
  });

  app.put<{ Params: { username: string } }>('/api/users/:username/profiles', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = setProfilesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'profiles must be an array of strings', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.setAssignedProfiles(request.params.username, parsed.data.profiles);
      return { ok: true };
    } catch (error: any) {
      const code = error.message?.includes('Invalid profile') ? 400 : 404;
      return reply.status(code).send({ error: error.message, code: 'SET_PROFILES_FAILED' });
    }
  });
}
```

- [ ] **Step 4: Register `userRoutes` in `packages/server/src/index.ts`**

Add import at the top:
```typescript
import { userRoutes } from './routes/users.js';
```

Add registration after `instanceRoutes`:
```typescript
await app.register(userRoutes);
```

- [ ] **Step 5: Run user route tests**

```bash
cd packages/server && npx vitest run tests/routes/users.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run all server tests**

```bash
cd packages/server && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/users.ts packages/server/src/index.ts packages/server/tests/routes/users.test.ts
git commit -m "feat: add user management API routes"
```

---

## Task 5: Apply authorization to existing routes

**Files:**
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/src/routes/instances.ts`
- Modify: `packages/server/src/routes/logs.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/profiles.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts` (add `request.user` decorator)

All existing route tests use a Fastify instance without auth, so `request.user` will be undefined. Those tests need to decorate `request.user` as a mock admin to pass the preHandlers.

- [ ] **Step 1: Update `packages/server/src/routes/fleet.ts`**

```typescript
// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';

const scaleSchema = z.object({ count: z.number().int().positive() });
let scaling = false;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async (request) => {
    const status = app.backend.getCachedStatus()
      ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
    if (!request.user || request.user.role === 'admin') return status;
    // Filter instances to assigned profiles only
    const assigned = new Set(request.user.assignedProfiles);
    return {
      ...status,
      instances: status.instances.filter((i) => assigned.has(i.id)),
      totalRunning: status.instances.filter((i) => assigned.has(i.id) && i.status === 'running').length,
    };
  });

  app.post('/api/fleet/scale', { preHandler: requireAdmin }, async (request, reply) => {
    if (app.deploymentMode === 'profiles') {
      return reply.status(400).send({
        error: 'scale endpoint not available in profile mode — use POST /api/fleet/profiles',
        code: 'WRONG_MODE',
      });
    }

    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'count must be a positive integer', code: 'INVALID_COUNT' });
    }

    if (scaling) {
      return reply.status(409).send({ error: 'Scale operation already in progress', code: 'SCALE_IN_PROGRESS' });
    }
    scaling = true;

    try {
      const { count } = parsed.data;
      const fleetStatus = await app.backend.scaleFleet(count, app.fleetDir);
      return { ok: true, fleet: fleetStatus };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'SCALE_FAILED' });
    } finally {
      scaling = false;
    }
  });
}
```

- [ ] **Step 2: Update `packages/server/tests/routes/fleet.test.ts`**

The test app needs a mock `request.user` attached via a hook so the `requireAdmin` preHandler passes. Add this `addHook` call inside `beforeAll` after `app.decorate(...)` calls:

```typescript
app.addHook('onRequest', async (request) => {
  (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
});
```

- [ ] **Step 3: Update `packages/server/src/routes/instances.ts`**

Add import at top:
```typescript
import { requireProfileAccess } from '../authorize.js';
```

Add `{ preHandler: requireProfileAccess }` to every route. Example for the first route:
```typescript
app.post<{ Params: { id: string } }>('/api/fleet/:id/start', { preHandler: requireProfileAccess }, async (request, reply) => {
```

Apply the same `{ preHandler: requireProfileAccess }` to all other routes in this file:
`/api/fleet/:id/stop`, `/api/fleet/:id/restart`, `/api/fleet/:id/devices/pending`, `/api/fleet/:id/devices/:requestId/approve`, `/api/fleet/:id/feishu/pairing`, `/api/fleet/:id/feishu/pairing/:code/approve`, `/api/fleet/:id/token/reveal`.

- [ ] **Step 4: Update `packages/server/tests/routes/instances.test.ts`**

Add mock user hook to `beforeAll` (same pattern as fleet test above):
```typescript
app.addHook('onRequest', async (request) => {
  (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
});
```

- [ ] **Step 5: Update `packages/server/src/routes/logs.ts`**

```typescript
// packages/server/src/routes/logs.ts
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';
import { requireAdmin, requireProfileAccess } from '../authorize.js';

export async function logRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/logs/:id',
    { websocket: true, preHandler: requireProfileAccess },
    async (socket: any, request) => {
      const { id } = request.params;
      if (!validateInstanceId(id, app.deploymentMode)) {
        socket.send(JSON.stringify({ error: 'Invalid instance id' }));
        socket.close();
        return;
      }
      const handle = app.backend.streamLogs(id, (line) => {
        socket.send(JSON.stringify({ id, line, ts: Date.now() }));
      });
      socket.on('close', () => handle.stop());
    },
  );

  app.get('/ws/logs', { websocket: true, preHandler: requireAdmin }, async (socket: any) => {
    const handle = app.backend.streamAllLogs((id, line) => {
      socket.send(JSON.stringify({ id, line, ts: Date.now() }));
    });
    socket.on('close', () => handle.stop());
  });
}
```

- [ ] **Step 6: Update `packages/server/tests/routes/logs.test.ts`**

Add mock user hook (same pattern):
```typescript
app.addHook('onRequest', async (request) => {
  (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
});
```

- [ ] **Step 7: Update `packages/server/src/routes/config.ts`**

Add import:
```typescript
import { requireAdmin, requireProfileAccess } from '../authorize.js';
```

Add preHandlers:
- `GET/PUT /api/config/fleet` → `requireAdmin`
- `GET/PUT /api/fleet/:id/config` → `requireProfileAccess`

```typescript
app.get('/api/config/fleet', { preHandler: requireAdmin }, async () => app.fleetConfig.readFleetConfig());
app.put('/api/config/fleet', { preHandler: requireAdmin }, async (request, reply) => { ... });
app.get<{ Params: { id: string } }>('/api/fleet/:id/config', { preHandler: requireProfileAccess }, async (request, reply) => { ... });
app.put<{ Params: { id: string } }>('/api/fleet/:id/config', { preHandler: requireProfileAccess }, async (request, reply) => { ... });
```

- [ ] **Step 8: Update `packages/server/tests/routes/config.test.ts`**

Add mock user hook inside `beforeAll`.

- [ ] **Step 9: Update `packages/server/src/routes/profiles.ts`**

Add import:
```typescript
import { requireAdmin, requireProfileAccess } from '../authorize.js';
```

Apply `requireAdmin` to `GET /api/fleet/profiles`, `POST /api/fleet/profiles`, `DELETE /api/fleet/profiles/:name`.
Apply `requireProfileAccess` to `GET /api/fleet/:id/plugins`, `POST /api/fleet/:id/plugins/install`, `DELETE /api/fleet/:id/plugins/:pluginId`.

- [ ] **Step 10: Update `packages/server/tests/routes/profiles.test.ts`**

Add mock user hook inside `beforeAll`.

- [ ] **Step 11: Run all server tests**

```bash
cd packages/server && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/routes/fleet.ts packages/server/src/routes/instances.ts packages/server/src/routes/logs.ts packages/server/src/routes/config.ts packages/server/src/routes/profiles.ts packages/server/tests/routes/fleet.test.ts packages/server/tests/routes/instances.test.ts packages/server/tests/routes/logs.test.ts packages/server/tests/routes/config.test.ts packages/server/tests/routes/profiles.test.ts
git commit -m "feat: apply requireAdmin and requireProfileAccess to existing routes"
```

---

## Task 6: Web — types, API client, hooks, and store

**Files:**
- Modify: `packages/web/src/types.ts`
- Create: `packages/web/src/api/users.ts`
- Create: `packages/web/src/hooks/useCurrentUser.ts`
- Create: `packages/web/src/hooks/useUsers.ts`
- Modify: `packages/web/src/store.ts`

- [ ] **Step 1: Add `PublicUser` to `packages/web/src/types.ts`**

Append at the end of the file:

```typescript
export interface PublicUser {
  username: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}
```

- [ ] **Step 2: Create `packages/web/src/api/users.ts`**

```typescript
import { apiFetch } from './client';
import type { PublicUser } from '../types';

export const getCurrentUser = () => apiFetch<PublicUser>('/api/users/me');

export const getUsers = () => apiFetch<PublicUser[]>('/api/users');

export const createUser = (username: string, password: string, role: 'admin' | 'user') =>
  apiFetch<PublicUser>('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });

export const deleteUser = (username: string) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}`, { method: 'DELETE' });

export const adminResetPassword = (username: string, password: string) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });

export const setAssignedProfiles = (username: string, profiles: string[]) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}/profiles`, {
    method: 'PUT',
    body: JSON.stringify({ profiles }),
  });

export const changeOwnPassword = (currentPassword: string, newPassword: string) =>
  apiFetch<{ ok: boolean }>('/api/users/me/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
```

- [ ] **Step 3: Create `packages/web/src/hooks/useCurrentUser.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '../api/users';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 4: Create `packages/web/src/hooks/useUsers.ts`**

```typescript
import { useQuery } from '@tanstack/react-query';
import { getUsers } from '../api/users';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });
}
```

- [ ] **Step 5: Update `packages/web/src/store.ts`**

Add `currentUser` and a `'users'` view option:

```typescript
import { create } from 'zustand';
import type { PublicUser } from './types';

type Tab = 'overview' | 'logs' | 'config' | 'metrics' | 'controlui' | 'feishu' | 'plugins';
type ActiveView = { type: 'instance'; id: string } | { type: 'config' } | { type: 'users' };

interface AppState {
  activeView: ActiveView;
  activeTab: Tab;
  currentUser: PublicUser | null;
  selectInstance: (id: string) => void;
  selectConfig: () => void;
  selectUsers: () => void;
  setTab: (tab: Tab) => void;
  setCurrentUser: (user: PublicUser | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: { type: 'config' },
  activeTab: 'overview',
  currentUser: null,
  selectInstance: (id) => set({ activeView: { type: 'instance', id }, activeTab: 'overview' }),
  selectConfig: () => set({ activeView: { type: 'config' } }),
  selectUsers: () => set({ activeView: { type: 'users' } }),
  setTab: (tab) => set({ activeTab: tab }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));

// Keep backwards-compatible selectedInstanceId selector for existing components
export const selectedInstanceIdSelector = (state: AppState) =>
  state.activeView.type === 'instance' ? state.activeView.id : null;
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/api/users.ts packages/web/src/hooks/useCurrentUser.ts packages/web/src/hooks/useUsers.ts packages/web/src/store.ts
git commit -m "feat: add user management API client, hooks, and store updates"
```

---

## Task 7: Web — ChangePasswordDialog and account indicator

**Files:**
- Create: `packages/web/src/components/users/ChangePasswordDialog.tsx`
- Modify: `packages/web/src/components/layout/Shell.tsx`

- [ ] **Step 1: Create `packages/web/src/components/users/ChangePasswordDialog.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changeOwnPassword, adminResetPassword } from '../../api/users';

interface Props {
  username: string;
  isAdmin: boolean;           // admin changing their own password
  targetUsername?: string;    // admin resetting another user — if set, use adminResetPassword
  onClose: () => void;
}

export function ChangePasswordDialog({ username, isAdmin, targetUsername, onClose }: Props) {
  const qc = useQueryClient();
  const isResetMode = !!targetUsername && targetUsername !== username;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      isResetMode
        ? adminResetPassword(targetUsername!, newPassword)
        : changeOwnPassword(currentPassword, newPassword),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['currentUser'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>{isResetMode ? `Reset password for ${targetUsername}` : 'Change Password'}</h2>
        {!isResetMode && (
          <label>
            Current password
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
        )}
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `packages/web/src/components/layout/Shell.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { FleetConfigPanel } from '../config/FleetConfigPanel';
import { InstancePanel } from '../instances/InstancePanel';
import { UserManagementPanel } from '../users/UserManagementPanel';
import { ChangePasswordDialog } from '../users/ChangePasswordDialog';
import { Sidebar } from './Sidebar';
import { useAppStore, selectedInstanceIdSelector } from '../../store';
import { useCurrentUser } from '../../hooks/useCurrentUser';

export function Shell() {
  const activeView = useAppStore((state) => state.activeView);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const { data: currentUser } = useCurrentUser();
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    if (currentUser) setCurrentUser(currentUser);
  }, [currentUser, setCurrentUser]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <div className="main-panel-topbar">
          {currentUser ? (
            <button className="account-indicator" onClick={() => setShowChangePassword(true)}>
              {currentUser.username} ({currentUser.role})
            </button>
          ) : null}
        </div>
        {activeView.type === 'instance' ? (
          <InstancePanel instanceId={activeView.id} />
        ) : activeView.type === 'users' ? (
          <UserManagementPanel />
        ) : (
          <FleetConfigPanel />
        )}
      </main>
      {showChangePassword && currentUser ? (
        <ChangePasswordDialog
          username={currentUser.username}
          isAdmin={currentUser.role === 'admin'}
          onClose={() => setShowChangePassword(false)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/users/ChangePasswordDialog.tsx packages/web/src/components/layout/Shell.tsx
git commit -m "feat: add ChangePasswordDialog and account indicator in Shell"
```

---

## Task 8: Web — UserManagementPanel and sidebar

**Files:**
- Create: `packages/web/src/components/users/UserManagementPanel.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create `packages/web/src/components/users/UserManagementPanel.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUsers } from '../../hooks/useUsers';
import { useFleet } from '../../hooks/useFleet';
import { createUser, deleteUser, setAssignedProfiles } from '../../api/users';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { useAppStore } from '../../store';
import type { PublicUser } from '../../types';

export function UserManagementPanel() {
  const currentUser = useAppStore((state) => state.currentUser);
  const { data: users, isLoading } = useUsers();
  const { data: fleet } = useFleet();
  const qc = useQueryClient();

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [createError, setCreateError] = useState('');

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [editProfilesTarget, setEditProfilesTarget] = useState<string | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const allProfiles = fleet?.instances.map((i) => i.id) ?? [];

  const createMut = useMutation({
    mutationFn: () => createUser(newUsername, newPassword, newRole),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setNewUsername(''); setNewPassword(''); setCreateError('');
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const profilesMut = useMutation({
    mutationFn: ({ username, profiles }: { username: string; profiles: string[] }) =>
      setAssignedProfiles(username, profiles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditProfilesTarget(null);
    },
  });

  if (isLoading) return <div className="panel-body">Loading users...</div>;

  return (
    <div className="panel-body">
      <h2>User Management</h2>

      <table className="data-table">
        <thead>
          <tr><th>Username</th><th>Role</th><th>Assigned Profiles</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {users?.map((u: PublicUser) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.role}</td>
              <td>{u.assignedProfiles.join(', ') || '—'}</td>
              <td>
                <button className="secondary-button" onClick={() => setResetTarget(u.username)}>Reset Password</button>
                {' '}
                <button className="secondary-button" onClick={() => {
                  setEditProfilesTarget(u.username);
                  setSelectedProfiles(u.assignedProfiles);
                }}>Profiles</button>
                {' '}
                {u.username !== currentUser?.username && (
                  <button className="danger-button" onClick={() => deleteMut.mutate(u.username)}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add User</h3>
      <div className="form-row">
        <input placeholder="Username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        <input type="password" placeholder="Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button className="primary-button" disabled={createMut.isPending} onClick={() => createMut.mutate()}>Add</button>
      </div>
      {createError ? <p className="error-text">{createError}</p> : null}

      {resetTarget && currentUser ? (
        <ChangePasswordDialog
          username={currentUser.username}
          isAdmin={true}
          targetUsername={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      ) : null}

      {editProfilesTarget ? (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Assign Profiles — {editProfilesTarget}</h2>
            <div className="profile-checklist">
              {allProfiles.map((pid) => (
                <label key={pid}>
                  <input
                    type="checkbox"
                    checked={selectedProfiles.includes(pid)}
                    onChange={(e) => setSelectedProfiles(
                      e.target.checked
                        ? [...selectedProfiles, pid]
                        : selectedProfiles.filter((p) => p !== pid)
                    )}
                  />
                  {pid}
                </label>
              ))}
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setEditProfilesTarget(null)}>Cancel</button>
              <button
                className="primary-button"
                disabled={profilesMut.isPending}
                onClick={() => profilesMut.mutate({ username: editProfilesTarget, profiles: selectedProfiles })}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Update `packages/web/src/components/layout/Sidebar.tsx`**

Replace the entire file to add `Users` entry and instance filtering:

```tsx
// packages/web/src/components/layout/Sidebar.tsx
import { useState, useEffect } from 'react';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore, selectedInstanceIdSelector } from '../../store';
import { SidebarItem } from './SidebarItem';
import { AddProfileDialog } from '../instances/AddProfileDialog';

export function Sidebar() {
  const { data, isLoading, error } = useFleet();
  const activeView = useAppStore((state) => state.activeView);
  const currentUser = useAppStore((state) => state.currentUser);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const selectConfig = useAppStore((state) => state.selectConfig);
  const selectUsers = useAppStore((state) => state.selectUsers);
  const [showAddProfile, setShowAddProfile] = useState(false);

  const selectedInstanceId = selectedInstanceIdSelector({ activeView } as any);

  // Filter instances for non-admin users (server already filters, this is defense-in-depth)
  const visibleInstances = data?.instances.filter((inst) => {
    if (!currentUser || currentUser.role === 'admin') return true;
    return currentUser.assignedProfiles.includes(inst.id);
  }) ?? [];

  useEffect(() => {
    if (!visibleInstances.length || selectedInstanceId) return;
    selectInstance(visibleInstances[0].id);
  }, [data, selectInstance, selectedInstanceId]);

  const isProfileMode = data?.mode === 'profiles';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="pill">Fleet Manager</p>
        <h1 className="sidebar-title">Claw Fleet</h1>
        <p className="sidebar-subtitle">
          {data ? `${data.totalRunning}/${visibleInstances.length} running` : isLoading ? 'Loading fleet...' : 'Awaiting server'}
        </p>
        {error ? <p className="error-text">{error.message}</p> : null}
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section">Instances</p>
        {visibleInstances.map((instance) => (
          <SidebarItem
            key={instance.id}
            instance={instance}
            selected={instance.id === selectedInstanceId}
            onClick={() => selectInstance(instance.id)}
          />
        ))}

        {currentUser?.role === 'admin' && (
          <>
            <p className="sidebar-section">Admin</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'users' ? ' selected' : ''}`}
              onClick={selectUsers}
            >
              Users
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {isProfileMode && currentUser?.role === 'admin' ? (
          <button className="primary-button" onClick={() => setShowAddProfile(true)}>
            + Add Profile
          </button>
        ) : null}
        <button className="secondary-button" onClick={selectConfig}>
          Fleet Config
        </button>
      </div>

      {showAddProfile ? <AddProfileDialog onClose={() => setShowAddProfile(false)} /> : null}
    </aside>
  );
}
```

- [ ] **Step 3: Fix existing components that use the old `selectedInstanceId` from store**

The old store exposed `selectedInstanceId` directly. The new store exposes `activeView`. Other components that call `useAppStore((state) => state.selectedInstanceId)` need to be updated to use the `selectedInstanceIdSelector`.

Find all usages:
```bash
grep -r "selectedInstanceId" packages/web/src --include="*.tsx" --include="*.ts" -l
```

For each component using `state.selectedInstanceId`, replace with `selectedInstanceIdSelector(state)`. The selector is already exported from `store.ts`.

Also update components that call `state.selectInstance(null)` (previously used to show Fleet Config) to call `state.selectConfig()` instead. Find these:
```bash
grep -r "selectInstance(null)" packages/web/src --include="*.tsx" -l
```

- [ ] **Step 4: Run the dev server and verify the UI**

```bash
npm run dev
```

- Open `http://localhost:5173` in browser
- Verify: account indicator shows in top-right
- Verify: "Users" section appears in sidebar when logged in as admin
- Verify: clicking "Users" shows the UserManagementPanel
- Verify: clicking "Fleet Config" shows the FleetConfigPanel
- Verify: "Change Password" dialog opens from account indicator

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/users/ packages/web/src/components/layout/Sidebar.tsx packages/web/src/components/layout/Shell.tsx
git commit -m "feat: add UserManagementPanel, sidebar Users entry, and instance filtering"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run all server tests**

```bash
cd packages/server && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit if anything changed**

```bash
git add -A
git commit -m "chore: fix any lint/type issues from user management implementation"
```
