import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionDockerInstance } from '../../src/services/docker-instance-provisioning.js';

describe('provisionDockerInstance', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docker-provision-test-'));
    mkdirSync(join(dir, 'managed'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes openclaw.json with gateway token, models, and workspace defaults', () => {
    provisionDockerInstance({
      instanceId: 'openclaw-1',
      index: 1,
      portStep: 20,
      configDir: join(dir, 'managed', 'openclaw-1', 'config'),
      workspaceDir: join(dir, 'managed', 'openclaw-1', 'workspace'),
      vars: {
        BASE_URL: 'https://api.example.com/v1',
        API_KEY: 'sk-test',
        MODEL_ID: 'test-model',
      },
      token: 'a'.repeat(64),
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'managed', 'openclaw-1', 'config', 'openclaw.json'), 'utf-8'),
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
      instanceId: 'openclaw-2',
      index: 2,
      portStep: 20,
      configDir: join(dir, 'managed', 'openclaw-2', 'config'),
      workspaceDir: join(dir, 'managed', 'openclaw-2', 'workspace'),
      vars: {},
      token: 'b'.repeat(64),
      tailscaleConfig: {
        hostname: 'machine.tailnet.ts.net',
        portMap: new Map([[2, 8801]]),
      },
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'managed', 'openclaw-2', 'config', 'openclaw.json'), 'utf-8'),
    );
    expect(config.gateway.auth.allowTailscale).toBe(true);
    expect(config.gateway.controlUi.allowInsecureAuth).toBe(true);
    expect(config.gateway.controlUi.allowedOrigins).toContain('https://machine.tailnet.ts.net:8801');
    expect(config.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18809');
  });

  it('applies a config override for a newly provisioned instance', () => {
    provisionDockerInstance({
      instanceId: 'openclaw-1',
      index: 1,
      portStep: 20,
      configDir: join(dir, 'managed', 'openclaw-1', 'config'),
      workspaceDir: join(dir, 'managed', 'openclaw-1', 'workspace'),
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
      readFileSync(join(dir, 'managed', 'openclaw-1', 'config', 'openclaw.json'), 'utf-8'),
    );
    expect(config.channels.feishu.enabled).toBe(true);
  });

  it('seeds workspace helper files', () => {
    provisionDockerInstance({
      instanceId: 'openclaw-1',
      index: 1,
      portStep: 20,
      configDir: join(dir, 'managed', 'openclaw-1', 'config'),
      workspaceDir: join(dir, 'managed', 'openclaw-1', 'workspace'),
      vars: {},
      token: 'd'.repeat(64),
    });

    expect(existsSync(join(dir, 'managed', 'openclaw-1', 'workspace', '.gitignore'))).toBe(true);
    expect(existsSync(join(dir, 'managed', 'openclaw-1', 'workspace', 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, 'managed', 'openclaw-1', 'workspace', 'MEMORY.md'))).toBe(true);
  });

  it('does not overwrite an existing openclaw.json', () => {
    mkdirSync(join(dir, 'managed', 'openclaw-1', 'config'), { recursive: true });
    writeFileSync(join(dir, 'managed', 'openclaw-1', 'config', 'openclaw.json'), '{"custom":true}\n');

    provisionDockerInstance({
      instanceId: 'openclaw-1',
      index: 1,
      portStep: 20,
      configDir: join(dir, 'managed', 'openclaw-1', 'config'),
      workspaceDir: join(dir, 'managed', 'openclaw-1', 'workspace'),
      vars: {},
      token: 'e'.repeat(64),
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'managed', 'openclaw-1', 'config', 'openclaw.json'), 'utf-8'),
    );
    expect(config.custom).toBe(true);
  });
});
