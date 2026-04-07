import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('normalizes legacy users without assignedProfiles', async () => {
    const usersFile = join(tmpDir, 'users.json');
    writeFileSync(usersFile, JSON.stringify({
      users: [
        { username: 'testuser', passwordHash: 'scrypt$deadbeef$deadbeef', role: 'user' },
      ],
    }), 'utf-8');

    await svc.initialize({ username: 'admin', password: 'password123' });
    expect(svc.get('testuser')?.assignedProfiles).toEqual([]);
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

  it('evicts cached verify results after profile changes', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');

    const before = await svc.verify('alice', 'password123');
    expect(before?.assignedProfiles).toEqual([]);

    await svc.setAssignedProfiles('alice', ['profile-a']);

    const after = await svc.verify('alice', 'password123');
    expect(after?.assignedProfiles).toEqual(['profile-a']);
  });

  it('throws on invalid profile name', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await expect(svc.setAssignedProfiles('alice', ['INVALID!'])).rejects.toThrow(/invalid profile/i);
  });

  it('enforces exclusive profile ownership across users', async () => {
    await svc.initialize({ username: 'admin', password: 'password123' });
    await svc.create('alice', 'password123', 'user');
    await svc.create('bob', 'password123', 'user');

    await svc.setAssignedProfiles('alice', ['profile-a', 'profile-b']);
    await svc.setAssignedProfiles('bob', ['profile-b', 'profile-c']);

    expect(svc.get('alice')?.assignedProfiles).toEqual(['profile-a']);
    expect(svc.get('bob')?.assignedProfiles).toEqual(['profile-b', 'profile-c']);
  });
});
