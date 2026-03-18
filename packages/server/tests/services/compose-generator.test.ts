import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
