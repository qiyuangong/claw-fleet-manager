// packages/server/src/services/backend.ts
import type { FleetInstance, FleetStatus, InstanceMode, InstanceRuntime } from '../types.js';

export function upsertCachedInstance(
  cache: FleetStatus | null,
  previousId: string,
  instance: FleetInstance,
): FleetStatus | null {
  if (!cache) return null;
  const instances = cache.instances
    .filter((item) => item.id !== previousId && item.id !== instance.id)
    .concat(instance)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    instances,
    totalRunning: instances.filter((item) => item.status === 'running').length,
    updatedAt: Date.now(),
  };
}

export class LockManager {
  private locks = new Map<string, boolean>();
  private renamedIds = new Map<string, string>();

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.withLocks([id], fn);
  }

  async withLocks<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      if (this.locks.get(id)) {
        throw new Error(`Instance "${id}" is locked`);
      }
    }
    for (const id of uniqueIds) {
      this.locks.set(id, true);
      this.renamedIds.set(id, id);
    }
    try {
      return await fn();
    } finally {
      for (const id of uniqueIds) {
        const currentId = this.renamedIds.get(id) ?? id;
        this.locks.set(currentId, false);
        this.renamedIds.delete(id);
      }
    }
  }

  rename(oldId: string, newId: string): void {
    if (!this.locks.has(oldId)) return;
    const value = this.locks.get(oldId) ?? false;
    this.locks.delete(oldId);
    this.locks.set(newId, value);
    for (const [id, currentId] of this.renamedIds) {
      if (currentId === oldId) {
        this.renamedIds.set(id, newId);
      }
    }
  }
}

export interface LogHandle {
  stop(): void;
}

export interface CreateInstanceOpts {
  runtime: InstanceRuntime;
  kind: InstanceMode;
  name?: string;
  port?: number;
  config?: object;
  // Docker-only per-instance overrides; ignored by profile creation for now.
  apiKey?: string;
  image?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  portStep?: number;
  enableNpmPackages?: boolean;
}

export interface DeploymentBackend {
  // Lifecycle
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;

  // Scaling / management
  createInstance(opts: CreateInstanceOpts): Promise<FleetInstance>;
  removeInstance(id: string): Promise<void>;
  renameInstance(id: string, nextName: string): Promise<FleetInstance>;

  // Monitoring
  getCachedStatus(): FleetStatus | null;
  refresh(): Promise<FleetStatus>;

  // Logs
  streamLogs(id: string, onData: (line: string) => void): LogHandle;
  streamAllLogs(onData: (id: string, line: string) => void): LogHandle;

  // In-process commands
  // args = tokens after "node dist/index.js" / "openclaw --profile <name>"
  execInstanceCommand(id: string, args: string[]): Promise<string>;

  // Token management
  revealToken(id: string): Promise<string>;

  // Per-instance config
  readInstanceConfig(id: string): Promise<object>;
  writeInstanceConfig(id: string, config: object): Promise<void>;

  // Init & teardown
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
