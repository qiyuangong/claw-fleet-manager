// packages/server/src/services/backend.ts
import type { FleetInstance, FleetStatus, InstanceMode } from '../types.js';

export interface LogHandle {
  stop(): void;
}

export interface CreateInstanceOpts {
  kind?: InstanceMode;
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
  // Count-based batch scale (Docker mode only; ProfileBackend throws 'not supported')
  scaleFleet(count: number, fleetDir: string): Promise<FleetStatus>;

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
