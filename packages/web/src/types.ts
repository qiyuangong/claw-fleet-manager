// packages/web/src/types.ts
export type InstanceRuntime = 'openclaw' | 'hermes';
export type InstanceMode = 'docker' | 'profile';

export interface RuntimeCapabilities {
  configEditor: boolean;
  logs: boolean;
  rename: boolean;
  delete: boolean;
  proxyAccess: boolean;
  sessions: boolean;
  plugins: boolean;
  runtimeAdmin: boolean;
}

export interface FleetInstance {
  id: string;
  runtime: InstanceRuntime;
  mode: InstanceMode;
  runtimeCapabilities: RuntimeCapabilities;
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
  instances: FleetInstance[];
  totalRunning: number;
  updatedAt: number;
}

export interface FleetConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  baseDir: string;
  cpuLimit: string;
  memLimit: string;
  portStep: number;
  tz: string;
  openclawImage: string;
  enableNpmPackages: boolean;
}

export interface PublicUser {
  username: string;
  role: 'admin' | 'user';
  assignedProfiles: string[];
}

export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
};

export type InstanceSessionsEntry = {
  instanceId: string;
  sessions: InstanceSessionRow[];
  error?: string;
};

export type FleetSessionsResult = {
  instances: InstanceSessionsEntry[];
  updatedAt: number;
};
