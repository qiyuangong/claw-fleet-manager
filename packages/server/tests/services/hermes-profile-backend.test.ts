import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { HermesProfileBackend } from '../../src/services/hermes-profile-backend.js';

const { mockSpawn, mockExecFile } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}));

describe('HermesProfileBackend', () => {
  let rootDir: string;
  let backend: HermesProfileBackend;
  let livePids: Set<number>;
  let profileHome: string;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'hermes-profile-backend-'));
    profileHome = join(rootDir, '.hermes', 'profiles', 'research-bot');
    livePids = new Set();
    mockSpawn.mockReset().mockImplementation((_cmd, _args, options) => {
      const child = {
        pid: 4321,
        unref: vi.fn(),
        on: vi.fn(),
        __options: options,
      };
      livePids.add(4321);
      return child as any;
    });
    mockExecFile.mockReset().mockImplementation((cmd, args, optionsOrCb, maybeCb) => {
      const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      if (cmd === 'ps') {
        const pid = String(args?.[2] ?? args?.[1] ?? '');
        let stdout = '';
        if (pid === '4321') {
          stdout = `HERMES_HOME=${profileHome} /usr/bin/env hermes gateway run`;
        } else if (pid === '9999') {
          stdout = `HERMES_HOME=${profileHome} /usr/bin/env hermes gateway run`;
        } else if (pid === '8888') {
          stdout = 'HERMES_HOME=/tmp/other-profile /usr/bin/env hermes gateway run';
        } else if (pid === '7777') {
          stdout = `HERMES_HOME=${profileHome} /usr/bin/node other-process`;
        }
        callback?.(null, { stdout, stderr: '' });
        return {} as any;
      }
      callback?.(null, { stdout: '', stderr: '' });
      return {} as any;
    });
    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        if (!livePids.has(pid)) {
          throw new Error('ESRCH');
        }
        return true;
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        livePids.delete(pid);
        return true;
      }
      return true;
    }) as typeof process.kill);

    backend = new HermesProfileBackend({
      binary: 'hermes',
      baseHomeDir: join(rootDir, '.hermes', 'profiles'),
      stopTimeoutMs: 10000,
    });
    await backend.initialize();
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.clearAllMocks();
    rmSync(rootDir, { recursive: true, force: true });
  });

  function createProfileHome(name: string, state: string, pid?: number): string {
    const home = join(rootDir, '.hermes', 'profiles', name);
    mkdirSync(join(home, 'logs'), { recursive: true });
    writeFileSync(join(home, 'config.yaml'), yaml.stringify({ agent: { name } }));
    writeFileSync(join(home, 'logs', 'gateway.log'), 'booted\n');
    writeFileSync(join(home, 'gateway_state.json'), JSON.stringify({ status: state }, null, 2));
    if (pid !== undefined) {
      writeFileSync(join(home, 'gateway.pid'), `${pid}\n`);
      livePids.add(pid);
    }
    return home;
  }

  function writeGatewayPidMetadata(home: string, pid: number): void {
    writeFileSync(
      join(home, 'gateway.pid'),
      JSON.stringify({
        pid,
        kind: 'hermes-gateway',
        argv: ['/tmp/hermes', 'gateway', 'run'],
        start_time: null,
      }),
    );
    livePids.add(pid);
  }

  it('createInstance adopts an existing Hermes profile home', async () => {
    const profileHome = createProfileHome('research-bot', 'stopped');

    const instance = await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    expect(instance.id).toBe('research-bot');
    expect(instance.runtime).toBe('hermes');
    expect(instance.mode).toBe('profile');
    expect(readFileSync(join(profileHome, 'config.yaml'), 'utf-8')).toContain('agent:');
    expect(readFileSync(join(profileHome, 'logs', 'gateway.log'), 'utf-8')).toContain('booted');
  });

  it('start launches hermes gateway run with HERMES_HOME and stop removes a running profile safely', async () => {
    const profileHome = createProfileHome('research-bot', 'stopped');

    await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    await backend.start('research-bot');

    expect(mockSpawn).toHaveBeenCalledWith(
      'hermes',
      ['gateway', 'run'],
      expect.objectContaining({
        detached: true,
        env: expect.objectContaining({ HERMES_HOME: profileHome }),
      }),
    );
    expect(readFileSync(join(profileHome, 'gateway.pid'), 'utf-8').trim()).toBe('4321');

    await backend.removeInstance('research-bot');

    expect(livePids.has(4321)).toBe(false);
    expect(() => readFileSync(join(profileHome, 'gateway.pid'), 'utf-8')).toThrow();
  });

  it('start waits for Hermes to replace the launcher pid with gateway metadata before reporting running', async () => {
    const profileHome = createProfileHome('research-bot', 'stopped');
    let resolveHandoff!: () => void;
    const handoff = new Promise<void>((resolve) => {
      resolveHandoff = resolve;
    });
    mockSpawn.mockReset().mockImplementationOnce((_cmd, _args, options) => {
      const home = options?.env?.HERMES_HOME as string;
      setTimeout(() => {
        if (existsSync(home)) {
          writeGatewayPidMetadata(home, 9999);
        }
        resolveHandoff();
      }, 25);
      return {
        pid: 4321,
        unref: vi.fn(),
        on: vi.fn(),
      } as any;
    });

    await backend.start('research-bot');
    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');
    try {
      expect(instance?.status).toBe('running');
      expect(instance?.pid).toBe(9999);
    } finally {
      await handoff;
    }
  });

  it('stale reused pid is not treated as a valid Hermes gateway', async () => {
    createProfileHome('research-bot', 'running', 7777);

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('stopped');
    expect(instance?.health).toBe('none');
  });

  it('refresh() recognizes Hermes JSON pid metadata written by the gateway', async () => {
    const home = createProfileHome('research-bot', 'running');
    writeGatewayPidMetadata(home, 9999);

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('running');
    expect(instance?.health).toBe('healthy');
    expect(instance?.pid).toBe(9999);
  });

  it('stop() terminates a Hermes gateway tracked by JSON pid metadata', async () => {
    const home = createProfileHome('research-bot', 'running');
    writeGatewayPidMetadata(home, 9999);

    await backend.stop('research-bot');

    expect(livePids.has(9999)).toBe(false);
    const state = JSON.parse(readFileSync(join(home, 'gateway_state.json'), 'utf-8'));
    expect(state.status).toBe('stopped');
  });

  it('live Hermes gateway for a different HERMES_HOME is not treated as owned by this profile', async () => {
    createProfileHome('research-bot', 'running', 8888);

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('stopped');
    expect(instance?.health).toBe('none');

    await backend.removeInstance('research-bot');
    expect(livePids.has(8888)).toBe(true);
  });

  it('renameInstance rejects while the Hermes profile is running', async () => {
    createProfileHome('research-bot', 'running', 4321);
    await backend.refresh();

    await expect(backend.renameInstance('research-bot', 'research-bot-2'))
      .rejects.toThrow(/stopped before it can be renamed/i);

    expect(readFileSync(join(rootDir, '.hermes', 'profiles', 'research-bot', 'gateway.pid'), 'utf-8').trim()).toBe('4321');
  });

  it('rejects concurrent mutations when a Hermes profile is already locked', async () => {
    const lockBackend = new HermesProfileBackend({
      binary: 'hermes',
      baseHomeDir: join(rootDir, '.hermes', 'profiles'),
      stopTimeoutMs: 50,
    });
    await lockBackend.initialize();

    createProfileHome('research-bot', 'running', 4321);
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        if (!livePids.has(pid)) {
          throw new Error('ESRCH');
        }
        return true;
      }
      if (signal === 'SIGKILL') {
        livePids.delete(pid);
        return true;
      }
      return true;
    }) as typeof process.kill);

    const stopPromise = lockBackend.stop('research-bot');

    await expect(lockBackend.renameInstance('research-bot', 'research-bot-2'))
      .rejects.toThrow(/locked/i);

    await stopPromise;
  });

  it('stale gateway_state.json without a live pid does not report running or healthy', async () => {
    createProfileHome('research-bot', 'running');

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('stopped');
    expect(instance?.health).toBe('none');
  });

  it('revealToken fails closed when no token exists', async () => {
    const profileHome = createProfileHome('research-bot', 'stopped');
    writeFileSync(join(profileHome, '.env'), 'OTHER_KEY=value\n');
    writeFileSync(join(profileHome, 'config.yaml'), yaml.stringify({ agent: {} }));

    await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    await expect(backend.revealToken('research-bot')).rejects.toThrow(/token not found/i);
  });

  it('writeInstanceConfig writes config.yaml atomically', async () => {
    const profileHome = createProfileHome('research-bot', 'stopped');
    await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    await backend.writeInstanceConfig('research-bot', { agent: { mode: 'chat' } });

    expect(readFileSync(join(profileHome, 'config.yaml'), 'utf-8')).toContain('mode: chat');
    expect(() => readFileSync(join(profileHome, 'config.yaml.tmp'), 'utf-8')).toThrow();
  });
});
