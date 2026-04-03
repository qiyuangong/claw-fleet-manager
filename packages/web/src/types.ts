// packages/web/src/types.ts
export interface FleetInstance {
  id: string;
  mode: 'docker' | 'profile';
  index?: number;
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
  profile?: string;
  pid?: number;            // profile mode only
}

export interface FleetStatus {
  mode: 'docker' | 'profiles' | 'hybrid';
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  count: number;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  configBase: string;
  workspaceBase: string;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}

export interface PublicUser {
  username: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}
