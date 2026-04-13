import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

  it('expands hermesProfiles.baseHomeDir from ~ to the user home', async () => {
    const configPath = join(dir, 'server.config.json');
    writeFileSync(configPath, JSON.stringify({
      port: 3001,
      auth: { username: 'admin', password: 'admin' },
      fleetDir: '/tmp/fleet',
      hermesProfiles: {
        baseHomeDir: '~/custom-hermes-profiles',
      },
    }, null, 2));
    process.env.FLEET_MANAGER_CONFIG = configPath;

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();

    expect(config.hermesProfiles?.baseHomeDir).toBe(join(homedir(), 'custom-hermes-profiles'));
  });
});
