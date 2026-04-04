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

function makeBaseDirBackend() {
  return new ProfileBackend('/tmp/fleet', config, '/tmp/managed');
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

    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => { cb(null, { stdout: '', stderr: '' }); return {} as any; });

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'INVALID NAME!' }))
      .rejects.toThrow('lowercase alphanumeric with hyphens');
  });

  it('createInstance() rejects the reserved main profile name', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: 'ENOENT' }); });
    const mockServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn((cb: () => void) => cb()) };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => { cb(null, { stdout: '', stderr: '' }); return {} as any; });

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'main' }))
      .rejects.toThrow('reserved');
  });

  it('createInstance() rejects duplicate non-reserved names', async () => {
    const registry = JSON.stringify({
      profiles: { rescue: { name: 'rescue', port: 18789, pid: null, configPath: '/tmp/configs/rescue/openclaw.json', stateDir: '/tmp/states/rescue' } },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);

    const backend = makeBackend();
    await backend.initialize();
    await expect(backend.createInstance({ name: 'rescue' }))
      .rejects.toThrow('Profile "rescue" already exists');
  });

  it('createInstance() writes an isolated workspace path into the generated profile config', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/tmp/fleet/profiles.json')) {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      }
      if (String(path).endsWith('/tmp/configs/rescue/openclaw.json')) {
        return JSON.stringify({
          agents: {
            defaults: {
              workspace: '/Users/syslab/.openclaw/workspace',
            },
          },
          gateway: { auth: { token: 'abc' } },
        });
      }
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });

    const mockServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn((cb: () => void) => cb()) };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((file: any, _args: any, optionsOrCb: any, maybeCb?: any) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      if (file === 'which') {
        cb(null, '/usr/local/bin/openclaw\n', '');
        return {} as any;
      }
      cb(null, '', '');
      return {} as any;
    });

    const backend = makeBackend();
    await backend.initialize();
    await backend.createInstance({ name: 'rescue' });

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(([path]) => String(path).endsWith('/tmp/configs/rescue/openclaw.json.tmp'));
    expect(writeCall).toBeTruthy();
    const written = JSON.parse(String(writeCall?.[1]));
    expect(written.agents.defaults.workspace).toBe('/tmp/states/rescue/workspace');

    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/states/rescue/workspace/MEMORY.md', expect.any(String), 'utf-8');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/states/rescue/workspace/CLAUDE.md', expect.any(String), 'utf-8');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/states/rescue/workspace/.gitignore', expect.any(String), 'utf-8');
  });

  it('createInstance() uses baseDir/<name> for profile config and workspace when configured', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/tmp/fleet/profiles.json')) {
        throw Object.assign(new Error(), { code: 'ENOENT' });
      }
      if (String(path).endsWith('/tmp/managed/rescue/openclaw.json')) {
        return JSON.stringify({
          agents: {
            defaults: {
              workspace: '/Users/syslab/.openclaw/workspace',
            },
          },
          gateway: { auth: { token: 'abc' } },
        });
      }
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });

    const mockServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn((cb: () => void) => cb()) };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((file: any, _args: any, optionsOrCb: any, maybeCb?: any) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      if (file === 'which') {
        cb(null, '/usr/local/bin/openclaw\n', '');
        return {} as any;
      }
      cb(null, '', '');
      return {} as any;
    });

    const backend = makeBaseDirBackend();
    await backend.initialize();
    await backend.createInstance({ name: 'rescue' });

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(([path]) => String(path).endsWith('/tmp/managed/rescue/openclaw.json.tmp'));
    expect(writeCall).toBeTruthy();
    const written = JSON.parse(String(writeCall?.[1]));
    expect(written.agents.defaults.workspace).toBe('/tmp/managed/rescue/workspace');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/managed/rescue/workspace/MEMORY.md', expect.any(String), 'utf-8');
  });

  it('initialize() migrates existing profile config workspace path and seeds workspace files', async () => {
    const registry = JSON.stringify({
      profiles: {
        main: {
          name: 'main',
          port: 18789,
          pid: null,
          configPath: '/tmp/configs/main/openclaw.json',
          stateDir: '/tmp/states/main',
        },
      },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/tmp/fleet/profiles.json')) {
        return registry;
      }
      if (String(path).endsWith('/tmp/configs/main/openclaw.json')) {
        return JSON.stringify({
          agents: {
            defaults: {
              workspace: '/Users/syslab/.openclaw/workspace',
            },
          },
        });
      }
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });
    vi.mocked(childProcess.execFile).mockImplementation((file: any, _args: any, optionsOrCb: any, maybeCb?: any) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      if (file === 'which') {
        cb(null, '/usr/local/bin/openclaw\n', '');
        return {} as any;
      }
      cb(null, '', '');
      return {} as any;
    });

    const backend = makeBackend();
    await backend.initialize();

    const migratedConfigCall = vi.mocked(fs.writeFileSync).mock.calls.find(([path]) =>
      String(path).endsWith('/tmp/configs/main/openclaw.json.tmp'));
    expect(migratedConfigCall).toBeTruthy();
    const migratedConfig = JSON.parse(String(migratedConfigCall?.[1]));
    expect(migratedConfig.agents.defaults.workspace).toBe('/tmp/states/main/workspace');
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/states/main/workspace/MEMORY.md', expect.any(String), 'utf-8');
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

describe('ProfileBackend — runtime env', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    const mockServer = {
      listen: vi.fn((_port: number, cb: () => void) => cb()),
      close: vi.fn((cb: () => void) => cb()),
      on: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('start() launches the gateway with the registry config/state env', async () => {
    const registry = JSON.stringify({
      profiles: {
        main: {
          name: 'main',
          port: 18789,
          pid: null,
          configPath: '/custom/configs/main/openclaw.json',
          stateDir: '/custom/states/main',
        },
      },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, cb: any) => {
      cb(null, { stdout: '/usr/local/bin/openclaw\n', stderr: '' });
      return {} as any;
    });

    const backend = makeBackend();
    await backend.initialize();
    await backend.start('main');

    expect(childProcess.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/openclaw$/),
      ['--profile', 'main', 'gateway', '--port', '18789'],
      expect.objectContaining({
        env: expect.objectContaining({
          OPENCLAW_CONFIG_PATH: '/custom/configs/main/openclaw.json',
          OPENCLAW_STATE_DIR: '/custom/states/main',
        }),
      }),
    );
  });

  it('start() detaches managed gateways and redirects logs to a file descriptor', async () => {
    const registry = JSON.stringify({
      profiles: {
        main: {
          name: 'main',
          port: 18789,
          pid: null,
          configPath: '/custom/configs/main/openclaw.json',
          stateDir: '/custom/states/main',
        },
      },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);
    vi.mocked(fs.openSync).mockReturnValue(88 as any);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, cb: any) => {
      cb(null, { stdout: '/usr/local/bin/openclaw\n', stderr: '' });
      return {} as any;
    });

    const backend = makeBackend();
    await backend.initialize();
    await backend.start('main');

    expect(fs.openSync).toHaveBeenCalledWith('/tmp/fleet/logs/main.log', 'a');
    expect(childProcess.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/openclaw$/),
      ['--profile', 'main', 'gateway', '--port', '18789'],
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', 88, 88],
      }),
    );
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('builds the runtime env from the registry config/state paths', async () => {
    const backend = makeBackend();
    const env = (backend as any).profileEnv({
      configPath: '/custom/configs/main/openclaw.json',
      stateDir: '/custom/states/main',
    });
    expect(env.OPENCLAW_CONFIG_PATH).toBe('/custom/configs/main/openclaw.json');
    expect(env.OPENCLAW_STATE_DIR).toBe('/custom/states/main');
  });

  it('builds gateway command args with the managed profile port and token auth', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (String(path).endsWith('/custom/configs/main/openclaw.json')) {
        return JSON.stringify({
          gateway: {
            auth: {
              mode: 'token',
              token: 'secret-token-xyz',
            },
          },
        });
      }
      throw Object.assign(new Error(), { code: 'ENOENT' });
    });

    const backend = makeBackend();
    const args = (backend as any).gatewayCommandArgs(
      {
        name: 'main',
        port: 18849,
        configPath: '/custom/configs/main/openclaw.json',
        stateDir: '/custom/states/main',
      },
      ['devices', 'list', '--json'],
    );

    expect(args).toEqual([
      'devices',
      'list',
      '--json',
      '--url',
      'ws://127.0.0.1:18849',
      '--token',
      'secret-token-xyz',
    ]);
  });

  it('only overrides gateway connection details for device commands', async () => {
    const backend = makeBackend();
    expect((backend as any).requiresGatewayOverride(['devices', 'list'])).toBe(true);
    expect((backend as any).requiresGatewayOverride(['pairing', 'list', 'feishu'])).toBe(false);
    expect((backend as any).requiresGatewayOverride(['plugins', 'list', '--json'])).toBe(false);
  });

  it('start() adopts an already-healthy gateway on the profile port instead of spawning', async () => {
    const registry = JSON.stringify({
      profiles: {
        main: {
          name: 'main',
          port: 18789,
          pid: null,
          configPath: '/custom/configs/main/openclaw.json',
          stateDir: '/custom/states/main',
        },
      },
      nextPort: 18809,
    });
    vi.mocked(fs.readFileSync).mockReturnValue(registry);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345, stdout: null, stderr: null };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.mocked(childProcess.execFile).mockImplementation((file: any, _args: any, optionsOrCb: any, maybeCb?: any) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      if (file === 'which') {
        cb(null, '/usr/local/bin/openclaw\n', '');
        return {} as any;
      }
      if (file === 'lsof') {
        cb(null, '45678\n', '');
        return {} as any;
      }
      cb(null, '', '');
      return {} as any;
    });

    const backend = makeBackend();
    await backend.initialize();
    await backend.start('main');

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:18789/healthz', expect.any(Object));
    const status = await backend.refresh();
    expect(status.instances[0]?.status).toBe('running');
  });

  it('stop() kills descendant processes and does not auto-restart an intentional stop', async () => {
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation((pid: number, signal?: NodeJS.Signals | 0) => {
        if (signal === 0) {
          return true;
        }
        return true;
      });

    const backend = new ProfileBackend('/tmp/fleet', { ...config, autoRestart: false });
    (backend as any).registry = {
      profiles: {
        main: {
          name: 'main',
          port: 18789,
          pid: 12345,
          configPath: '/custom/configs/main/openclaw.json',
          stateDir: '/custom/states/main',
        },
      },
      nextPort: 18809,
    };
    (backend as any).listDescendantPids = vi.fn().mockResolvedValue([54321]);
    await backend.stop('main');

    expect(killSpy).toHaveBeenCalledWith(54321, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect((backend as any).stopping.has('main')).toBe(true);
  });
});

describe('ProfileBackend — createInstanceFromMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    const mockServer = {
      listen: vi.fn((_port: number, cb: () => void) => cb()),
      close: vi.fn((cb: () => void) => cb()),
      on: vi.fn(),
    };
    vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    const mockChild = { on: vi.fn(), unref: vi.fn(), pid: 12345 };
    vi.mocked(childProcess.spawn).mockReturnValue(mockChild as any);
    vi.mocked(childProcess.execFile).mockImplementation((_f, _a, _o, cb: any) => {
      cb(null, { stdout: '/usr/local/bin/openclaw', stderr: '' });
      return {} as any;
    });
  });

  it('createInstanceFromMigration() writes openclaw.json with preserved token and workspace path', async () => {
    const backend = makeBackend();
    await backend.initialize();

    await (backend as any).createInstanceFromMigration({
      name: 'migrated',
      workspaceDir: '/tmp/docker-base/migrated/workspace',
      configDir: '/tmp/docker-base/migrated/config',
      token: 'abc123preserved',
    });

    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const configWrite = writeCalls.find(([path]) => String(path).includes('openclaw.json'));
    expect(configWrite).toBeDefined();
    const written = JSON.parse(String(configWrite![1]));
    expect(written.gateway.auth.token).toBe('abc123preserved');
    expect(written.agents.defaults.workspace).toBe('/tmp/docker-base/migrated/workspace');
  });

  it('createInstanceFromMigration() registers profile in registry', async () => {
    const backend = makeBackend();
    await backend.initialize();

    await (backend as any).createInstanceFromMigration({
      name: 'migrated',
      workspaceDir: '/tmp/docker-base/migrated/workspace',
      configDir: '/tmp/docker-base/migrated/config',
      token: 'abc123',
    });

    const { stateDir } = (backend as any).getInstanceDir('migrated');
    expect(stateDir).toBe('/tmp/docker-base/migrated');
  });

  it('getInstanceDir() throws when profile not found', async () => {
    const backend = makeBackend();
    await backend.initialize();
    expect(() => (backend as any).getInstanceDir('nonexistent')).toThrow('not found');
  });
});
