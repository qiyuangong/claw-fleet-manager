export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
  },
  required: ['error', 'code'],
} as const;

export const okResponseSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
} as const;

export const fleetInstanceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    runtime: { type: 'string', enum: ['openclaw', 'hermes'] },
    mode: { type: 'string', enum: ['docker', 'profile'] },
    index: { type: 'number' },
    status: { type: 'string', enum: ['running', 'stopped', 'restarting', 'unhealthy', 'unknown'] },
    port: { type: 'number' },
    token: { type: 'string' },
    tailscaleUrl: { type: 'string' },
    uptime: { type: 'number' },
    cpu: { type: 'number' },
    memory: {
      type: 'object',
      properties: {
        used: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['used', 'limit'],
    },
    disk: {
      type: 'object',
      properties: {
        config: { type: 'number' },
        workspace: { type: 'number' },
      },
      required: ['config', 'workspace'],
    },
    runtimeCapabilities: {
      type: 'object',
      properties: {
        configEditor: { type: 'boolean' },
        logs: { type: 'boolean' },
        rename: { type: 'boolean' },
        delete: { type: 'boolean' },
        proxyAccess: { type: 'boolean' },
        sessions: { type: 'boolean' },
        plugins: { type: 'boolean' },
        runtimeAdmin: { type: 'boolean' },
      },
      required: ['configEditor', 'logs', 'rename', 'delete', 'proxyAccess', 'sessions', 'plugins', 'runtimeAdmin'],
    },
    health: { type: 'string', enum: ['healthy', 'unhealthy', 'starting', 'none'] },
    image: { type: 'string' },
    profile: { type: 'string' },
    pid: { type: 'number' },
  },
  required: ['id', 'runtime', 'mode', 'runtimeCapabilities', 'status', 'port', 'token', 'uptime', 'cpu', 'memory', 'disk', 'health', 'image'],
} as const;

export const fleetStatusSchema = {
  type: 'object',
  properties: {
    instances: { type: 'array', items: fleetInstanceSchema },
    totalRunning: { type: 'number' },
    updatedAt: { type: 'number' },
  },
  required: ['instances', 'totalRunning', 'updatedAt'],
} as const;

export const fleetConfigSchema = {
  type: 'object',
  properties: {
    baseUrl: { type: 'string' },
    apiKey: { type: 'string' },
    modelId: { type: 'string' },
    baseDir: { type: 'string' },
    cpuLimit: { type: 'string' },
    memLimit: { type: 'string' },
    portStep: { type: 'number' },
    tz: { type: 'string' },
    openclawImage: { type: 'string' },
    enableNpmPackages: { type: 'boolean' },
  },
  required: [
    'baseUrl',
    'apiKey',
    'modelId',
    'baseDir',
    'cpuLimit',
    'memLimit',
    'portStep',
    'tz',
    'openclawImage',
    'enableNpmPackages',
  ],
} as const;

export const instanceIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
  },
  required: ['id'],
} as const;
