// packages/server/src/config.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ServerConfig } from './types.js';

const schema = z.object({
  port: z.number().int().positive().default(3001),
  auth: z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  fleetDir: z.string().min(1),
});

export function loadConfig(): ServerConfig {
  const configPath = process.env.FLEET_MANAGER_CONFIG
    ?? resolve(import.meta.dirname, '..', 'server.config.json');

  const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
  return schema.parse(raw);
}
