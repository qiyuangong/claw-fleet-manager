// packages/server/src/types.ts
export interface TailscaleConfig {
  hostname: string;
  portMap: Map<number, number>;
}

export interface ServerConfig {
  port: number;
  auth: { username: string; password: string };
  fleetDir: string;
  tailscale?: { hostname: string };
  tls?: { cert: string; key: string };
  deploymentMode?: 'docker' | 'profiles';
  profiles?: ProfilesConfig;
}

export interface ProfilesConfig {
  openclawBinary: string;
  basePort: number;
  portStep: number;
  stateBaseDir: string;
  configBaseDir: string;
  autoRestart: boolean;
  stopTimeoutMs: number;
}

export interface FleetInstance {
  id: string;
  index?: number;          // present in docker mode (1-based), absent in profile mode
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  tailscaleUrl?: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  profile?: string;        // profile mode only: profile name
  pid?: number;            // profile mode only: OS process ID
}

export interface FleetStatus {
  mode: 'docker' | 'profiles';
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
}

export interface User {
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}

export type PublicUser = Omit<User, 'passwordHash'>;
