import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { HermesProfileBackend } from '../../src/services/hermes-profile-backend.js';

describe('HermesProfileBackend', () => {
  let rootDir: string;
  let backend: HermesProfileBackend;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'hermes-profile-backend-'));
    backend = new HermesProfileBackend({
      binary: 'hermes',
      baseHomeDir: join(rootDir, '.hermes', 'profiles'),
      stopTimeoutMs: 10000,
    });
    await backend.initialize();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('createInstance creates a Hermes profile instance with hermes runtime metadata', async () => {
    const instance = await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    expect(instance.runtime).toBe('hermes');
    expect(instance.mode).toBe('profile');
    expect(instance.profile).toBe('research-bot');
    expect(instance.runtimeCapabilities.proxyAccess).toBe(false);
    expect(instance.runtimeCapabilities.logs).toBe(true);
    expect(instance.status).toBe('stopped');
    expect(instance.port).toBe(0);
    expect(instance.image).toBe('hermes');
    expect(instance.token).toBe('hidden');

    const profileHome = join(rootDir, '.hermes', 'profiles', 'research-bot');
    expect(yaml.parse(readFileSync(join(profileHome, 'config.yaml'), 'utf-8'))).toEqual(
      expect.objectContaining({ agent: expect.any(Object) }),
    );
    expect(readFileSync(join(profileHome, 'logs', 'gateway.log'), 'utf-8')).toBe('');
  });

  it('readInstanceConfig reads config.yaml from the profile home', async () => {
    await backend.createInstance({
      runtime: 'hermes',
      kind: 'profile',
      name: 'research-bot',
    });

    const config = await backend.readInstanceConfig('research-bot');

    expect(config).toEqual(expect.objectContaining({ agent: expect.any(Object) }));
  });
});
