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

function normalizeLoadedUser(raw: any): User | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.username !== 'string' || typeof raw.passwordHash !== 'string') return null;

  const role: 'admin' | 'user' = raw.role === 'admin' ? 'admin' : 'user';
  const assignedProfiles = Array.isArray(raw.assignedProfiles)
    ? raw.assignedProfiles.filter((value: unknown): value is string => typeof value === 'string')
    : [];

  return {
    username: raw.username,
    passwordHash: raw.passwordHash,
    role,
    assignedProfiles,
  };
}

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

  async initialize(
    bootstrap: { username: string; password: string },
    options: { seedTestUser?: boolean } = {},
  ): Promise<void> {
    const { seedTestUser = false } = options;
    if (existsSync(this.usersFile)) {
      const data = JSON.parse(readFileSync(this.usersFile, 'utf-8'));
      const loadedUsers = Array.isArray(data.users) ? data.users : [];
      this.users = loadedUsers
        .map((raw: unknown) => normalizeLoadedUser(raw))
        .filter((user: User | null): user is User => user !== null);
      this.persist();
    } else {
      const bootstrapPasswordHash = await hashPassword(bootstrap.password);
      const users: User[] = [
        { username: bootstrap.username, passwordHash: bootstrapPasswordHash, role: 'admin', assignedProfiles: [] },
      ];

      // Seed an optional default non-admin user for local testing.
      if (seedTestUser && bootstrap.username !== 'testuser') {
        const testUserPasswordHash = await hashPassword('testuser');
        users.push({ username: 'testuser', passwordHash: testUserPasswordHash, role: 'user', assignedProfiles: [] });
      }

      this.users = users;
      this.persist();
    }
    // Always pre-compute sentinel for timing-safe unknown-user verify
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

    const resultCopy = result ? { ...result } : null;
    this.cache.set(key, { result: resultCopy, expiresAt: now + CACHE_TTL_MS });
    return resultCopy;
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
    // No cache eviction needed: new users have no cached entries yet
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
    this.evictCache();
    this.persist();
  }

  async setPassword(username: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new Error('Invalid password: minimum 8 characters');
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    user.passwordHash = await hashPassword(newPassword);
    this.evictCache();
    this.persist();
  }

  async verifyAndSetPassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new Error('Current password is incorrect');
    if (newPassword.length < 8) throw new Error('Invalid password: minimum 8 characters');
    user.passwordHash = await hashPassword(newPassword);
    this.evictCache();
    this.persist();
  }

  async setAssignedProfiles(username: string, profiles: string[]): Promise<void> {
    const uniqueProfiles = Array.from(new Set(profiles));
    for (const p of uniqueProfiles) {
      if (!PROFILE_NAME_RE.test(p)) throw new Error(`Invalid profile name: '${p}'`);
    }
    const user = this.users.find(u => u.username === username);
    if (!user) throw new Error(`User '${username}' not found`);

    // A profile can belong to only one user at a time.
    // Reassigning profiles to this user automatically removes them from others.
    const reassigned = new Set(uniqueProfiles);
    for (const other of this.users) {
      if (other.username === username) continue;
      other.assignedProfiles = other.assignedProfiles.filter((p) => !reassigned.has(p));
    }

    user.assignedProfiles = uniqueProfiles;
    this.evictCache();
    this.persist();
  }

  async renameAssignedProfile(oldId: string, newId: string): Promise<void> {
    if (oldId === newId) return;

    let changed = false;
    const nextUsers = this.users.map((user) => {
      const nextProfiles = user.assignedProfiles.map((profile) => {
        if (profile !== oldId) return profile;
        changed = true;
        return newId;
      });
      return {
        ...user,
        assignedProfiles: Array.from(new Set(nextProfiles)),
      };
    });

    if (!changed) return;
    this.persist(nextUsers);
    this.users = nextUsers;
    this.evictCache();
  }

  private evictCache(): void {
    this.cache.clear();
  }

  private persist(users: User[] = this.users): void {
    const tmp = `${this.usersFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ users }, null, 2), 'utf-8');
    renameSync(tmp, this.usersFile);
  }
}
