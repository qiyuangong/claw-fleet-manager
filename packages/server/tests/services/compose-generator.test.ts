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
    expect(config1.allowedOrigins).toContain('https://machine.tailnet.ts.net:8800');

    const config2 = JSON.parse(
      readFileSync(join(dir, 'instances', '2', 'openclaw.json'), 'utf-8'),
    );
    expect(config2.allowedOrigins).toContain('https://machine.tailnet.ts.net:8801');
  });

  it('does not write openclaw.json when tailscaleConfig is absent', () => {
    const gen = new ComposeGenerator(dir);
    gen.generate(2);
    expect(existsSync(join(dir, 'instances', '1', 'openclaw.json'))).toBe(false);
  });

  it('skips writing openclaw.json when portMap does not contain the instance index', () => {
    const gen = new ComposeGenerator(dir);
    // portMap only covers index 1, not index 2
    gen.generate(2, {
      hostname: 'machine.tailnet.ts.net',
      portMap: new Map([[1, 8800]]),
    });
    expect(existsSync(join(dir, 'instances', '2', 'openclaw.json'))).toBe(false);
    // index 1 should still get its config
    expect(existsSync(join(dir, 'instances', '1', 'openclaw.json'))).toBe(true);
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
});
