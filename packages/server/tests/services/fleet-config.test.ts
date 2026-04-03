import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FleetConfigService } from '../../src/services/fleet-config.js';

describe('FleetConfigService', () => {
  let dir: string;
  let svc: FleetConfigService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fleet-test-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    svc = new FleetConfigService(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('readFleetConfig', () => {
    it('reads openclawImage from fleet.env', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), 'OPENCLAW_IMAGE=myrepo/openclaw:v2\n');
      const config = svc.readFleetConfig();
      expect(config.openclawImage).toBe('myrepo/openclaw:v2');
    });

    it('defaults openclawImage to openclaw:local when absent', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), 'BASE_URL=https://api.example.com/v1\n');
      const config = svc.readFleetConfig();
      expect(config.openclawImage).toBe('openclaw:local');
    });

    it('reads enableNpmPackages=true', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), 'ENABLE_NPM_PACKAGES=true\n');
      const config = svc.readFleetConfig();
      expect(config.enableNpmPackages).toBe(true);
    });

    it('defaults enableNpmPackages to false when absent', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), 'BASE_URL=https://api.example.com/v1\n');
      const config = svc.readFleetConfig();
      expect(config.enableNpmPackages).toBe(false);
    });

    it('parses fleet.env with defaults', () => {
      writeFileSync(join(dir, 'config', 'fleet.env'), [
        'BASE_URL=https://api.example.com/v1',
        'API_KEY=sk-test123',
        'MODEL_ID=gpt-4',
        'COUNT=3',
      ].join('\n'));

      const config = svc.readFleetConfig();
      expect(config.baseUrl).toBe('https://api.example.com/v1');
      expect(config.apiKey).toBe('sk-t***t123');
      expect(config.modelId).toBe('gpt-4');
      expect(config.count).toBe(3);
      expect(config.cpuLimit).toBe('4');
      expect(config.memLimit).toBe('8G');
      expect(config.portStep).toBe(20);
    });
  });

  describe('readTokens', () => {
    it('reads tokens from .env file', () => {
      writeFileSync(join(dir, '.env'), [
        'TOKEN_1=abc123def',
        'TOKEN_2=xyz789ghi',
      ].join('\n'));

      expect(svc.readTokens()).toEqual({ 1: 'abc123def', 2: 'xyz789ghi' });
    });
  });

  describe('maskToken', () => {
    it('masks middle of token', () => {
      expect(FleetConfigService.maskToken('abc123def456')).toBe('abc1***f456');
    });
  });

  describe('readInstanceConfig', () => {
    it('reads openclaw.json for instance', () => {
      const configBase = join(dir, 'instances');
      mkdirSync(join(configBase, '1'), { recursive: true });
      writeFileSync(join(configBase, '1', 'openclaw.json'), '{"gateway":{}}');
      writeFileSync(join(dir, 'config', 'fleet.env'), `CONFIG_BASE=${configBase}`);

      expect(svc.readInstanceConfig(1)).toEqual({ gateway: {} });
    });
  });

  describe('writeInstanceConfig', () => {
    it('atomically writes openclaw.json', () => {
      const configBase = join(dir, 'instances');
      mkdirSync(join(configBase, '2'), { recursive: true });
      writeFileSync(join(configBase, '2', 'openclaw.json'), '{}');
      writeFileSync(join(dir, 'config', 'fleet.env'), `CONFIG_BASE=${configBase}`);

      svc.writeInstanceConfig(2, { gateway: { mode: 'token' } });

      const written = JSON.parse(readFileSync(join(configBase, '2', 'openclaw.json'), 'utf-8'));
      expect(written.gateway.mode).toBe('token');
    });
  });
});
