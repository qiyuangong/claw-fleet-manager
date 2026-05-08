import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkFleetDirWritable,
  checkOpenClawBinary,
  checkTlsFiles,
  PreflightError,
  runPreflight,
} from '../src/preflight.js';
import type { ServerConfig } from '../src/types.js';

describe('checkFleetDirWritable', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'preflight-fleet-'));
  });

  afterEach(() => {
    try { chmodSync(dir, 0o700); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the fleetDir if missing', () => {
    const target = join(dir, 'nested', 'fleet');
    expect(() => checkFleetDirWritable(target)).not.toThrow();
  });

  it('passes when the dir already exists and is writable', () => {
    expect(() => checkFleetDirWritable(dir)).not.toThrow();
  });

  it('throws PreflightError when the dir is not writable', () => {
    if (process.getuid?.() === 0) return; // root bypasses W_OK; skip
    chmodSync(dir, 0o500);
    expect(() => checkFleetDirWritable(dir)).toThrow(PreflightError);
  });

  it('throws PreflightError when the dir is writable but not traversable', () => {
    if (process.getuid?.() === 0) return; // root bypasses access checks; skip
    chmodSync(dir, 0o200);
    expect(() => checkFleetDirWritable(dir)).toThrow(PreflightError);
  });
});

describe('checkTlsFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'preflight-tls-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes when both cert and key are readable', () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key.pem');
    writeFileSync(cert, 'x');
    writeFileSync(key, 'x');
    expect(() => checkTlsFiles({ cert, key })).not.toThrow();
  });

  it('throws when cert is missing', () => {
    const cert = join(dir, 'missing.pem');
    const key = join(dir, 'key.pem');
    writeFileSync(key, 'x');
    expect(() => checkTlsFiles({ cert, key })).toThrow(PreflightError);
  });

  it('throws when key is missing', () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'missing.pem');
    writeFileSync(cert, 'x');
    expect(() => checkTlsFiles({ cert, key })).toThrow(PreflightError);
  });

  it('throws when the cert path resolves to a directory', () => {
    const cert = join(dir, 'cert-dir');
    mkdirSync(cert);
    const key = join(dir, 'key.pem');
    writeFileSync(key, 'x');
    expect(() => checkTlsFiles({ cert, key })).toThrow(PreflightError);
  });

  it('throws when the key path resolves to a directory', () => {
    const cert = join(dir, 'cert.pem');
    const key = join(dir, 'key-dir');
    writeFileSync(cert, 'x');
    mkdirSync(key);
    expect(() => checkTlsFiles({ cert, key })).toThrow(PreflightError);
  });
});

describe('checkOpenClawBinary', () => {
  it('passes when the binary responds to --version', async () => {
    await expect(checkOpenClawBinary('node')).resolves.toBeUndefined();
  });

  it('throws PreflightError when the binary is not found', async () => {
    await expect(
      checkOpenClawBinary('does-not-exist-claw-fleet-test'),
    ).rejects.toBeInstanceOf(PreflightError);
  });
});

describe('runPreflight', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'preflight-run-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs only fleetDir check when tls and profiles are absent', async () => {
    const config = {
      fleetDir: dir,
      auth: { username: 'admin', password: 'pw' },
      port: 3001,
      seedTestUser: false,
      baseDir: dir,
      sessionHistory: { enabled: false, retentionDays: 30, collectIntervalMs: 30000, activeMinutes: 180 },
    } as unknown as ServerConfig;
    await expect(runPreflight(config)).resolves.toBeUndefined();
  });

  it('checks openclaw binary when profiles are configured', async () => {
    const config = {
      fleetDir: dir,
      auth: { username: 'admin', password: 'pw' },
      port: 3001,
      seedTestUser: false,
      baseDir: dir,
      sessionHistory: { enabled: false, retentionDays: 30, collectIntervalMs: 30000, activeMinutes: 180 },
      profiles: {
        openclawBinary: 'does-not-exist-claw-fleet-test',
        basePort: 18789,
        portStep: 20,
        stateBaseDir: dir,
        configBaseDir: dir,
        autoRestart: true,
        stopTimeoutMs: 10000,
      },
    } as unknown as ServerConfig;
    await expect(runPreflight(config)).rejects.toBeInstanceOf(PreflightError);
  });
});
