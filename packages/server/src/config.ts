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

const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
  tailscale: z.object({ hostname: z.string().min(1) }).optional(),
  tls: z.object({
    cert: z.string().min(1),
    key: z.string().min(1),
  }).optional(),
  deploymentMode: z.enum(['docker', 'profiles']).default('docker'),
  profiles: profilesSchema.optional(),
});

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function loadConfig(): ServerConfig {
  const configPath = process.env.FLEET_MANAGER_CONFIG
    ?? resolve(import.meta.dirname, '..', 'server.config.json');

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  const parsed = schema.parse(raw) as ServerConfig;

  // Expand ~ in profile paths
  if (parsed.profiles) {
    parsed.profiles.stateBaseDir = expandHome(parsed.profiles.stateBaseDir);
    parsed.profiles.configBaseDir = expandHome(parsed.profiles.configBaseDir);
  }

  return parsed;
}
