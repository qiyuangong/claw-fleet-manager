import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ComposeGenerator } from '../../src/services/compose-generator.js';

describe('ComposeGenerator', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'compose-test-'));
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'config', 'fleet.env'), [
      'BASE_URL=https://api.example.com/v1',
      'API_KEY=sk-test',
      'MODEL_ID=test-model',
      'CPU_LIMIT=2',
      'MEM_LIMIT=4G',
      'PORT_STEP=20',
      `CONFIG_BASE=${join(dir, 'instances')}`,
      `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
    ].join('\n'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates docker-compose.yml for N instances', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(3);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    expect(content).toContain('openclaw-1:');
    expect(content).toContain('openclaw-2:');
    expect(content).toContain('openclaw-3:');
    expect(content).toContain('"18789:18789"');
    expect(content).toContain('"18809:18789"');
    expect(content).toContain('"18829:18789"');
    expect(content).toContain('cpus: "2"');
    expect(content).toContain('memory: 4G');
    expect(content).toContain('net-openclaw-1:');
    expect(content).toContain('net-openclaw-2:');
    expect(content).toContain('net-openclaw-3:');
  });

  it('preserves existing tokens when regenerating', () => {
    writeFileSync(join(dir, '.env'), 'TOKEN_1=existingtoken123\nTOKEN_2=othertoken456\n');

    const gen = new ComposeGenerator(dir);
    gen.generate(3);

    const envContent = readFileSync(join(dir, '.env'), 'utf-8');
    expect(envContent).toContain('TOKEN_1=existingtoken123');
    expect(envContent).toContain('TOKEN_2=othertoken456');
    expect(envContent).toContain('TOKEN_3=');
  });

  it('keeps tokens for scaled-down instances so scale-up restores them', () => {
    writeFileSync(
      join(dir, '.env'),
      'TOKEN_1=existingtoken123\nTOKEN_2=othertoken456\nTOKEN_3=keepme789\n',
    );

    const gen = new ComposeGenerator(dir);
    gen.generate(2);

    const envContent = readFileSync(join(dir, '.env'), 'utf-8');
    expect(envContent).toContain('TOKEN_1=existingtoken123');
    expect(envContent).toContain('TOKEN_2=othertoken456');
    expect(envContent).toContain('TOKEN_3=keepme789');
  });

  it('writes openclaw.json with tailscale auth config for new instances', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(2, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map([[1, 8800], [2, 8801]]),
    });

    const config1 = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config1.gateway.auth.allowTailscale).toBe(true);
    expect(config1.gateway.controlUi.allowInsecureAuth).toBe(true);
    expect(config1.gateway.controlUi.allowedOrigins).toContain('https://machine.tailnet.ts.net:8800');
    expect(config1.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18789');
    expect(config1.gateway.controlUi.allowedOrigins).toContain('http://localhost:18789');

    const config2 = JSON.parse(
      readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
    );
    expect(config2.gateway.controlUi.allowedOrigins).toContain('https://machine.tailnet.ts.net:8801');
  });

  it('does not overwrite existing openclaw.json on re-scale', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(1, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map([[1, 8800]]),
    });
    // Simulate user customisation
    writeFileSync(join(dir, 'instances', '1', 'openclaw.json'), '{"custom":true}');
    gen.generate(2, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map([[1, 8800], [2, 8801]]),
    });
    const content = JSON.parse(readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'));
    expect(content.custom).toBe(true);
  });

  it('writes openclaw.json with gateway token and model config for new instances', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(2);

    const config1 = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config1.gateway.auth.mode).toBe('token');
    expect(config1.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
    expect(config1.gateway.mode).toBe('local');
    expect(config1.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18789');
    expect(config1.gateway.controlUi.allowedOrigins).toContain('http://localhost:18789');
    expect(config1.models.providers.default.baseUrl).toBe('https://api.example.com/v1');
    expect(config1.models.providers.default.apiKey).toBe('sk-test');
    expect(config1.models.providers.default.models[0].id).toBe('test-model');

    const config2 = JSON.parse(
      readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
    );
    expect(config2.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18809');
  });

  it('omits models block when BASE_URL is blank', () => {
    writeFileSync(join(dir, 'config', 'fleet.env'), [
      'PORT_STEP=20',
      `CONFIG_BASE=${join(dir, 'instances')}`,
      `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
    ].join('\n'));
    const gen = new ComposeGenerator(dir);
    gen.generate(1);

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config.models).toBeUndefined();
    expect(config.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not overwrite existing openclaw.json when regenerating without tailscale', () => {
    mkdirSync(join(dir, 'instances', '1'), { recursive: true });
    writeFileSync(join(dir, 'instances', '1', 'openclaw.json'), '{"custom":true}');

    const gen = new ComposeGenerator(dir);
    gen.generate(2);

    const content = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(content.custom).toBe(true);
  });

  it('merges tailscale fields on top of base config', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(1, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map([[1, 8800]]),
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    expect(config.gateway.auth.mode).toBe('token');
    expect(config.models.providers.default.baseUrl).toBe('https://api.example.com/v1');
    expect(config.gateway.auth.allowTailscale).toBe(true);
    expect(config.gateway.controlUi.allowInsecureAuth).toBe(true);
    expect(config.gateway.controlUi.allowedOrigins).toContain('https://machine.tailnet.ts.net:8800');
    expect(config.gateway.controlUi.allowedOrigins).toContain('http://127.0.0.1:18789');
    expect(config.gateway.controlUi.allowedOrigins).toContain('http://localhost:18789');
  });

  it('writes base openclaw.json without tailscale fields when instance not in portMap', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(1, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map(), // instance 1 not in map
    });

    const config = JSON.parse(
      readFileSync(join(dir, 'instances', '1', 'openclaw.json'), 'utf-8'),
    );
    // Base config still written
    expect(config.gateway.auth.mode).toBe('token');
    expect(config.gateway.auth.token).toMatch(/^[0-9a-f]{64}$/);
    // No tailscale fields
    expect(config.gateway.auth.allowTailscale).toBeUndefined();
    expect(config.gateway.controlUi.allowInsecureAuth).toBeUndefined();
    // controlUi.allowedOrigins has only the two localhost origins
    expect(config.gateway.controlUi.allowedOrigins).toHaveLength(2);
  });

  it('writes literal OPENCLAW_IMAGE from fleet.env into compose', () => {
    writeFileSync(join(dir, 'config', 'fleet.env'), [
      'OPENCLAW_IMAGE=myrepo/openclaw:v2',
      'CPU_LIMIT=2',
      'MEM_LIMIT=4G',
      'PORT_STEP=20',
      `CONFIG_BASE=${join(dir, 'instances')}`,
      `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
    ].join('\n'));

    const gen = new ComposeGenerator(dir);
    gen.generate(1);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    expect(content).toContain('image: myrepo/openclaw:v2');
    expect(content).not.toContain('${OPENCLAW_IMAGE');
  });

  it('defaults image to openclaw:local when OPENCLAW_IMAGE is absent', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(1);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    expect(content).toContain('image: openclaw:local');
  });

  it('adds .npm mount per instance when ENABLE_NPM_PACKAGES=true', () => {
    writeFileSync(join(dir, 'config', 'fleet.env'), [
      'ENABLE_NPM_PACKAGES=true',
      'CPU_LIMIT=2',
      'MEM_LIMIT=4G',
      'PORT_STEP=20',
      `CONFIG_BASE=${join(dir, 'instances')}`,
      `WORKSPACE_BASE=${join(dir, 'workspaces')}`,
    ].join('\n'));

    const gen = new ComposeGenerator(dir);
    gen.generate(2);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    const npmMount1 = `${join(dir, 'instances')}/1/.npm:/home/node/.npm`;
    const npmMount2 = `${join(dir, 'instances')}/2/.npm:/home/node/.npm`;
    expect(content).toContain(npmMount1);
    expect(content).toContain(npmMount2);
  });

  it('does not add .npm mount when ENABLE_NPM_PACKAGES is absent', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(2);

    const content = readFileSync(join(dir, 'docker-compose.yml'), 'utf-8');
    expect(content).not.toContain('.npm:/home/node/.npm');
  });
});
