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
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (event === 'exit') {
            child.__onExit = handler;
          }
        }),
        __onExit: undefined as undefined | ((code: number | null, signal: NodeJS.Signals | null) => void),
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
      if (signal === 'SIGTERM') {
        livePids.delete(pid);
        return true;
      }
      if (signal === 'SIGKILL') {
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

  it('createInstance adopts an existing Hermes profile home', async () => {
    const profileHome = join(rootDir, '.hermes', 'profiles', 'research-bot');
    mkdirSync(join(profileHome, 'logs'), { recursive: true });
    writeFileSync(join(profileHome, 'config.yaml'), yaml.stringify({ agent: { name: 'research-bot' } }));
    writeFileSync(join(profileHome, 'logs', 'gateway.log'), 'booted\n');
    writeFileSync(join(profileHome, 'gateway_state.json'), JSON.stringify({ status: 'running' }, null, 2));

    const instance = await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    expect(instance.id).toBe('research-bot');
    expect(instance.runtime).toBe('hermes');
    expect(instance.mode).toBe('profile');
    expect(readFileSync(join(profileHome, 'config.yaml'), 'utf-8')).toContain('agent:');
  });

  it('lifecycle launch arguments and env use hermes gateway run and HERMES_HOME', async () => {
    const profileHome = join(rootDir, '.hermes', 'profiles', 'research-bot');
    mkdirSync(profileHome, { recursive: true });
    writeFileSync(join(profileHome, 'config.yaml'), yaml.stringify({ agent: {} }));
    writeFileSync(join(profileHome, 'gateway_state.json'), JSON.stringify({ status: 'stopped' }, null, 2));

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
        env: expect.objectContaining({
          HERMES_HOME: profileHome,
        }),
      }),
    );

    const pidPath = join(profileHome, 'gateway.pid');
    expect(readFileSync(pidPath, 'utf-8').trim()).toBe('4321');

    await backend.stop('research-bot');
    expect(livePids.has(4321)).toBe(false);
    expect(readFileSync(join(profileHome, 'gateway_state.json'), 'utf-8')).toContain('stopped');
  });

  it('buildInstance derives status from gateway_state.json when pid is absent', async () => {
    const profileHome = join(rootDir, '.hermes', 'profiles', 'research-bot');
    mkdirSync(profileHome, { recursive: true });
    writeFileSync(join(profileHome, 'config.yaml'), yaml.stringify({ agent: {} }));
    writeFileSync(join(profileHome, 'gateway_state.json'), JSON.stringify({ status: 'running' }, null, 2));

    await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    const status = await backend.refresh();
    const instance = status.instances.find((item) => item.id === 'research-bot');

    expect(instance?.status).toBe('running');
    expect(instance?.health).toBe('healthy');
  });
});
