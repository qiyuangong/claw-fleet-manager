import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'hermes-profile-backend-'));
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
    mockExecFile.mockReset().mockImplementation((_cmd, _args, _options, callback) => {
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
    const profileHome = join(rootDir, '.hermes', 'profiles', name);
    mkdirSync(join(profileHome, 'logs'), { recursive: true });
    writeFileSync(join(profileHome, 'config.yaml'), yaml.stringify({ agent: { name } }));
    writeFileSync(join(profileHome, 'logs', 'gateway.log'), 'booted\n');
    writeFileSync(join(profileHome, 'gateway_state.json'), JSON.stringify({ status: state }, null, 2));
    if (pid !== undefined) {
      writeFileSync(join(profileHome, 'gateway.pid'), `${pid}\n`);
      livePids.add(pid);
    }
    return profileHome;
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

  it('renameInstance rejects while the Hermes profile is running', async () => {
    createProfileHome('research-bot', 'running', 4321);
    await backend.refresh();

    await expect(backend.renameInstance('research-bot', 'research-bot-2'))
      .rejects.toThrow(/stopped before it can be renamed/i);

    expect(readFileSync(join(rootDir, '.hermes', 'profiles', 'research-bot', 'gateway.pid'), 'utf-8').trim()).toBe('4321');
  });

  it('stale gateway_state.json without a live pid does not report running or healthy', async () => {
    createProfileHome('research-bot', 'running');

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('stopped');
    expect(instance?.health).toBe('none');
  });
});
