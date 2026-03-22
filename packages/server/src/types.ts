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
}

export interface FleetInstance {
  id: string;
  index: number;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string; // always masked
  tailscaleUrl?: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
}

export interface FleetStatus {
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
