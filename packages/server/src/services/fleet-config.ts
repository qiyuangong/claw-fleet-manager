import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FleetConfig } from '../types.js';

export class FleetConfigService {
  constructor(private fleetDir: string) {}

  readFleetConfig(countOverride?: number): FleetConfig {
    const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));

    return {
      baseUrl: vars.BASE_URL ?? '',
      apiKey: vars.API_KEY ? FleetConfigService.maskToken(vars.API_KEY) : '',
      modelId: vars.MODEL_ID ?? '',
      count: parseInt(vars.COUNT ?? String(countOverride ?? 2), 10),
      cpuLimit: vars.CPU_LIMIT ?? '4',
      memLimit: vars.MEM_LIMIT ?? '4G',
      portStep: parseInt(vars.PORT_STEP ?? '20', 10),
      configBase: vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances'),
      workspaceBase: vars.WORKSPACE_BASE ?? join(process.env.HOME ?? '', 'openclaw-workspaces'),
      tz: vars.TZ ?? 'Asia/Shanghai',
      openclawImage: vars.OPENCLAW_IMAGE ?? 'openclaw:local',
      enableNpmPackages: vars.ENABLE_NPM_PACKAGES === 'true',
    };
  }

  readFleetEnvRaw(): Record<string, string> {
    return this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));
  }

  writeFleetConfig(vars: Record<string, string>): void {
    this.ensureFleetDirectories();
    const envPath = join(this.fleetDir, 'config', 'fleet.env');
    const lines = Object.entries(vars)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}=${value}`);
    this.atomicWrite(envPath, lines.join('\n') + '\n');
  }

  writeTokens(tokens: Record<number, string>): void {
    const envPath = join(this.fleetDir, '.env');
    const lines = Object.entries(tokens)
      .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
      .map(([idx, token]) => `TOKEN_${idx}=${token}`);
    this.atomicWrite(envPath, lines.join('\n') + '\n');
  }

  readTokens(): Record<number, string> {
    const envPath = join(this.fleetDir, '.env');
    let content: string;
    try {
      content = readFileSync(envPath, 'utf-8');
    } catch {
      return {};
    }

    const tokens: Record<number, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^TOKEN_(\d+)=(.+)$/);
      if (match) {
        tokens[parseInt(match[1], 10)] = match[2];
      }
    }

    return tokens;
  }

  getConfigBase(): string {
    const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));
    return vars.CONFIG_BASE ?? join(process.env.HOME ?? '', 'openclaw-instances');
  }

  getWorkspaceBase(): string {
    const vars = this.parseEnvFile(join(this.fleetDir, 'config', 'fleet.env'));
    return vars.WORKSPACE_BASE ?? join(process.env.HOME ?? '', 'openclaw-workspaces');
  }

  readInstanceConfig(index: number): unknown {
    const configBase = this.getConfigBase();
    const path = join(configBase, String(index), 'openclaw.json');
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  writeInstanceConfig(index: number, config: unknown): void {
    const configBase = this.getConfigBase();
    const path = join(configBase, String(index), 'openclaw.json');
    mkdirSync(join(configBase, String(index)), { recursive: true });
    this.atomicWrite(path, JSON.stringify(config, null, 2) + '\n');
  }

  ensureFleetDirectories(): void {
    mkdirSync(join(this.fleetDir, 'config'), { recursive: true });
    mkdirSync(this.getConfigBase(), { recursive: true });
    mkdirSync(this.getWorkspaceBase(), { recursive: true });
  }

  static maskToken(token: string): string {
    if (token.length <= 7) return '***';
    return token.slice(0, 4) + '***' + token.slice(-4);
  }

  private parseEnvFile(path: string): Record<string, string> {
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch {
      return {};
    }

    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
    return vars;
  }

  private atomicWrite(path: string, content: string): void {
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, path);
  }
}
