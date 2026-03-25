// packages/server/tests/services/profile-backend.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfileBackend } from '../../src/services/profile-backend.js';
import type { ProfilesConfig } from '../../src/types.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as net from 'node:net';
import * as childProcess from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('node:net');
vi.mock('node:child_process');

const config: ProfilesConfig = {
  openclawBinary: 'openclaw',
  basePort: 18789,
  portStep: 20,
  stateBaseDir: '/tmp/states',
  configBaseDir: '/tmp/configs',
  autoRestart: false,
  stopTimeoutMs: 100,
};

function makeBackend() {
  return new ProfileBackend('/tmp/fleet', config);
}

describe('ProfileBackend — registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // profiles.json doesn't exist
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
  });

  it('starts with empty registry when profiles.json missing', async () => {
    const backend = makeBackend();
    await backend.initialize();
    const status = backend.getCachedStatus();
    expect(status?.instances).toHaveLength(0);
  });

  it('createInstance() validates name format', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const mockServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn((cb: () => void) => cb()) };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);

    const mockChild = { on: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => { cb(null, { stdout: '', stderr: '' }); return {} as any; });

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'INVALID NAME!' }))
      .rejects.toThrow('Invalid profile name');
  });

  it('createInstance() rejects duplicate names', async () => {
    const registry = JSON.stringify({
      profiles: { main: { name: 'main', port: 18789, pid: null, configPath: '/tmp/configs/main/openclaw.json', stateDir: '/tmp/states/main' } },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'main' }))
      .rejects.toThrow('Profile "main" already exists');
  });
});

describe('ProfileBackend — revealToken', () => {
  it('reads token from openclaw.json gateway.auth.token', async () => {
    const configJson = JSON.stringify({ gateway: { auth: { token: 'secret-token-xyz' } } });
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('openclaw.json')) return configJson;
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    const backend = makeBackend();
    await backend.initialize();

    // Inject a profile entry directly
    const registry = JSON.stringify({
      profiles: { main: { name: 'main', port: 18789, pid: null, configPath: '/tmp/configs/main/openclaw.json', stateDir: '/tmp/states/main' } },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);

    const backend2 = makeBackend();
    await backend2.initialize();
    // revealToken reads the config file
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).includes('openclaw.json')) return configJson;
      return registry;
    });
    const token = await backend2.revealToken('main');
    expect(token).toBe('secret-token-xyz');
  });
});

describe('ProfileBackend — getCachedStatus', () => {
  it('returns mode=profiles', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const backend = makeBackend();
    await backend.initialize();
    const status = backend.getCachedStatus();
    expect(status?.mode).toBe('profiles');
  });
});
