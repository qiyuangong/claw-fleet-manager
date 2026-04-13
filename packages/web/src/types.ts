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
  previewItems?: InstanceSessionPreviewItem[];
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

export type InstanceSessionPreviewItem = {
  role: string;
  text: string;
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
