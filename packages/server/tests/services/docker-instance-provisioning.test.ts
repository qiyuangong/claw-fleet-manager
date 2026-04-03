import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionDockerInstance } from '../../src/services/docker-instance-provisioning.js';

describe('provisionDockerInstance', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docker-provision-test-'));
    mkdirSync(join(dir, 'instances'), { recursive: true });
    mkdirSync(join(dir, 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes openclaw.json with gateway token, models, and workspace defaults', () => {
    provisionDockerInstance({
      index: 1,
      portStep: 20,
      configBase: join(dir, 'instances'),
      workspaceBase: join(dir, 'workspaces'),
      vars: {
        BASE_URL: 'https://api.example.com/v1',
        API_KEY: 'sk-test',
        MODEL_ID: 'test-model',
      },
      token: 'a'.repeat(64),
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config.gateway.auth.mode).toBe('token');
    expect(config.gateway.auth.token).toBe('a'.repeat(64));
    expect(config.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18789');
    expect(config.agents.defaults.workspace).toBe('/home/node/.openclaw/workspace');
    expect(config.models.providers.default.baseUrl).toBe('https://api.example.com/v1');
    expect(config.models.providers.default.apiKey).toBe('sk-test');
  });

  it('merges tailscale fields when a port is allocated', () => {
    provisionDockerInstance({
      index: 2,
      portStep: 20,
      configBase: join(dir, 'instances'),
      workspaceBase: join(dir, 'workspaces'),
      vars: {},
      token: 'b'.repeat(64),
      tailscaleConfig: {
        hostname: 'machine.tailnet.ts.net',
        portMap: new Map([[2, 8801]]),
      },
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
    );
    expect(config.gateway.auth.allowTailscale).toBe(true);
    expect(config.gateway.controlUi.allowInsecureAuth).toBe(true);
    expect(config.gateway.controlUi.allowedOrigins).toContain('https://machine.tailnet.ts.net:8801');
    expect(config.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18809');
  });

  it('applies a config override for a newly provisioned instance', () => {
    provisionDockerInstance({
      index: 1,
      portStep: 20,
      configBase: join(dir, 'instances'),
      workspaceBase: join(dir, 'workspaces'),
      vars: {},
      token: 'c'.repeat(64),
      configOverride: {
        channels: {
          feishu: {
            enabled: true,
          },
        },
      },
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config.channels.feishu.enabled).toBe(true);
  });

  it('seeds workspace helper files', () => {
    provisionDockerInstance({
      index: 1,
      portStep: 20,
      configBase: join(dir, 'instances'),
      workspaceBase: join(dir, 'workspaces'),
      vars: {},
      token: 'd'.repeat(64),
    });

    expect(existsSync(join(dir, 'workspaces', '1', '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, 'workspaces', '1', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'workspaces', '1', 'MEMORY.md'))).toBe(true);
  });

  it('does not overwrite an existing openclaw.json', () => {
    mkdirSync(join(dir, 'instances', '1'), { recursive: true });
    writeFileSync(join(dir, 'instances', '1', 'openclaw.json'), '{"custom":true}\n');

    provisionDockerInstance({
      index: 1,
      portStep: 20,
      configBase: join(dir, 'instances'),
      workspaceBase: join(dir, 'workspaces'),
      vars: {},
      token: 'e'.repeat(64),
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config.custom).toBe(true);
  });
});
