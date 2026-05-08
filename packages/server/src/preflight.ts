// packages/server/src/preflight.ts
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ServerConfig } from './types.js';

const execFileAsync = promisify(execFile);

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightError';
  }
}

export function checkFleetDirWritable(fleetDir: string): void {
  try {
    mkdirSync(fleetDir, { recursive: true });
    accessSync(fleetDir, fsConstants.W_OK);
  } catch {
    throw new PreflightError(
      `fleetDir '${fleetDir}' is not writable. ` +
      `Check the path in server.config.json and your filesystem permissions.`,
    );
  }
}

export function checkTlsFiles(tls: { cert: string; key: string }): void {
  const entries: Array<['cert' | 'key', string]> = [
    ['cert', tls.cert],
    ['key', tls.key],
  ];
  for (const [name, p] of entries) {
    const resolved = resolve(p);
    try {
      accessSync(resolved, fsConstants.R_OK);
    } catch {
      throw new PreflightError(
        `TLS ${name} not readable: ${resolved}. ` +
        `Generate certs or remove the "tls" block from server.config.json.`,
      );
    }
  }
}

export async function checkOpenClawBinary(binary: string): Promise<void> {
  try {
    await execFileAsync(binary, ['--version']);
  } catch {
    throw new PreflightError(
      `openclaw binary '${binary}' not found or not executable. ` +
      `Install openclaw or update profiles.openclawBinary in server.config.json.`,
    );
  }
}

export async function runPreflight(config: ServerConfig): Promise<void> {
  checkFleetDirWritable(config.fleetDir);
  if (config.tls) checkTlsFiles(config.tls);
  if (config.profiles) await checkOpenClawBinary(config.profiles.openclawBinary);
}
