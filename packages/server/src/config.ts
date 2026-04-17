// packages/server/src/config.ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ServerConfig } from './types.js';

const profilesSchema = z.object({
  openclawBinary: z.string().default('openclaw'),
  basePort: z.number().int().positive().default(18789),
  portStep: z.number().int().positive().default(20),
  stateBaseDir: z.string().default(join(homedir(), '.openclaw-states')),
  configBaseDir: z.string().default(join(homedir(), '.openclaw-configs')),
  autoRestart: z.boolean().default(true),
  stopTimeoutMs: z.number().int().positive().default(10000),
});

const hermesDockerSchema = z.object({
  image: z.string().default('ghcr.io/nousresearch/hermes-agent:latest'),
  mountPath: z.string().default('/opt/data'),
  env: z.record(z.string(), z.string()).default({}),
});

const sessionHistorySchema = z.object({
  enabled: z.boolean().default(true),
  retentionDays: z.number().int().positive().default(30),
  collectIntervalMs: z.number().int().positive().default(30_000),
  activeMinutes: z.number().int().positive().default(180),
});

const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  seedTestUser: z.boolean().default(false),
  fleetDir: z.string().min(1),
  baseDir: z.string().default(join(homedir(), 'openclaw-instances')),
  tailscale: z.object({ hostname: z.string().min(1) }).optional(),
  tls: z.object({
    cert: z.string().min(1),
    key: z.string().min(1),
  }).optional(),
  profiles: profilesSchema.optional(),
  hermesDocker: hermesDockerSchema.optional(),
  sessionHistory: sessionHistorySchema.default({}),
});

export function resolveConfigPath(): string {
  return process.env.FLEET_MANAGER_CONFIG
    ?? resolve(import.meta.dirname, '..', 'server.config.json');
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function loadConfig(): ServerConfig {
  const raw = JSON.parse(readFileSync(resolveConfigPath(), 'utf-8'));
  const parsed = schema.parse(raw) as ServerConfig;

  // Expand ~ in profile paths
  if (parsed.profiles) {
    parsed.profiles.stateBaseDir = expandHome(parsed.profiles.stateBaseDir);
    parsed.profiles.configBaseDir = expandHome(parsed.profiles.configBaseDir);
  }
  if (parsed.baseDir) {
    parsed.baseDir = expandHome(parsed.baseDir);
  }

  return parsed;
}
