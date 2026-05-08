import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loadConfig', () => {
  let dir: string;
  let previousConfigPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'server-config-'));
    previousConfigPath = process.env.FLEET_MANAGER_CONFIG;
  });

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.FLEET_MANAGER_CONFIG;
    } else {
      process.env.FLEET_MANAGER_CONFIG = previousConfigPath;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('expands baseDir from ~ to the user home', async () => {
    const configPath = join(dir, 'server.config.json');
    writeFileSync(configPath, JSON.stringify({
      port: 3001,
      auth: { username: 'admin', password: 'admin' },
      fleetDir: '/tmp/fleet',
      baseDir: '~/custom-openclaw-instances',
    }, null, 2));
    process.env.FLEET_MANAGER_CONFIG = configPath;

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.baseDir).toContain('custom-openclaw-instances');
  });
});

describe('assertSafeAuthPassword', () => {
  let previousBypass: string | undefined;

  beforeEach(() => {
    previousBypass = process.env.FLEET_ALLOW_DEFAULT_PASSWORD;
    delete process.env.FLEET_ALLOW_DEFAULT_PASSWORD;
  });

  afterEach(() => {
    if (previousBypass === undefined) {
      delete process.env.FLEET_ALLOW_DEFAULT_PASSWORD;
    } else {
      process.env.FLEET_ALLOW_DEFAULT_PASSWORD = previousBypass;
    }
  });

  it('rejects the legacy "changeme" default', async () => {
    const { assertSafeAuthPassword, InsecureDefaultPasswordError } = await import('../src/config.js');
    expect(() => assertSafeAuthPassword('changeme')).toThrow(InsecureDefaultPasswordError);
  });

  it('rejects the example placeholder', async () => {
    const { assertSafeAuthPassword, InsecureDefaultPasswordError } = await import('../src/config.js');
    expect(() => assertSafeAuthPassword('<change-me-before-starting>')).toThrow(InsecureDefaultPasswordError);
  });

  it('rejects empty/whitespace passwords', async () => {
    const { assertSafeAuthPassword, InsecureDefaultPasswordError } = await import('../src/config.js');
    expect(() => assertSafeAuthPassword('')).toThrow(InsecureDefaultPasswordError);
    expect(() => assertSafeAuthPassword('   ')).toThrow(InsecureDefaultPasswordError);
  });

  it('accepts a non-default password', async () => {
    const { assertSafeAuthPassword } = await import('../src/config.js');
    expect(() => assertSafeAuthPassword('s3cure-pass!')).not.toThrow();
  });

  it('bypasses the guard when FLEET_ALLOW_DEFAULT_PASSWORD=1', async () => {
    process.env.FLEET_ALLOW_DEFAULT_PASSWORD = '1';
    const { assertSafeAuthPassword } = await import('../src/config.js');
    expect(() => assertSafeAuthPassword('changeme')).not.toThrow();
  });
});
