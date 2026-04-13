import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { configRoutes } from '../../src/routes/config.js';

const configEditorCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
} as const;

const fleetInstances = [
  { id: 'openclaw-1', runtime: 'openclaw' as const, mode: 'docker' as const, runtimeCapabilities: configEditorCapabilities },
  { id: 'openclaw-profile', runtime: 'openclaw' as const, mode: 'profile' as const, runtimeCapabilities: configEditorCapabilities },
  { id: 'hermes-lab', runtime: 'hermes' as const, mode: 'docker' as const, runtimeCapabilities: configEditorCapabilities },
  { id: 'research-bot', runtime: 'hermes' as const, mode: 'profile' as const, runtimeCapabilities: configEditorCapabilities },
];

const mockFleetConfig = {
  readFleetConfig: vi.fn(),
  readFleetEnvRaw: vi.fn().mockReturnValue({
    BASE_URL: 'https://api.example.com',
    API_KEY: 'sk-test123',
    MODEL_ID: 'gpt-4',
    OPENCLAW_IMAGE: 'openclaw:local',
    CPU_LIMIT: '4',
    MEM_LIMIT: '8G',
    PORT_STEP: '20',
    TZ: 'UTC',
  }),
  writeFleetConfig: vi.fn(),
  updateBaseDir: vi.fn(),
};

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue({
    mode: 'hybrid',
    instances: fleetInstances,
    totalRunning: 4,
    updatedAt: Date.now(),
  }),
  refresh: vi.fn().mockResolvedValue({
    mode: 'hybrid',
    instances: fleetInstances,
    totalRunning: 4,
    updatedAt: Date.now(),
  }),
  readInstanceConfig: vi.fn().mockResolvedValue({ gateway: { mode: 'token' } }),
  writeInstanceConfig: vi.fn().mockResolvedValue(undefined),
};

describe('Config routes — hybrid mode', () => {
  const app = Fastify();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFleetConfig.readFleetConfig.mockImplementation(() => ({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-***123',
      modelId: 'gpt-4',
      baseDir: '/tmp/managed',
      cpuLimit: '4',
      memLimit: '8G',
      portStep: 20,
      tz: 'UTC',
      openclawImage: 'openclaw:local',
      enableNpmPackages: false,
    }));
    mockFleetConfig.readFleetEnvRaw.mockReturnValue({
      BASE_URL: 'https://api.example.com',
      API_KEY: 'sk-test123',
      MODEL_ID: 'gpt-4',
      OPENCLAW_IMAGE: 'openclaw:local',
      CPU_LIMIT: '4',
      MEM_LIMIT: '8G',
      PORT_STEP: '20',
      TZ: 'UTC',
    });
    mockBackend.getCachedStatus.mockReturnValue({
      mode: 'hybrid',
      instances: fleetInstances,
      totalRunning: 4,
      updatedAt: Date.now(),
    });
    mockBackend.refresh.mockResolvedValue({
      mode: 'hybrid',
      instances: fleetInstances,
      totalRunning: 4,
      updatedAt: Date.now(),
    });
  });

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
    app.decorate('backend', mockBackend);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(configRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/config/fleet returns masked fleet config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().apiKey).toBe('sk-***123');
    expect(res.json().baseDir).toBe('/tmp/managed');
    expect(mockFleetConfig.readFleetConfig).toHaveBeenCalledWith();
  });

  it('GET /api/config/fleet omits deprecated sizing/path fields', async () => {
    mockFleetConfig.readFleetConfig.mockReturnValueOnce({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-***123',
      modelId: 'gpt-4',
      baseDir: '/tmp/managed',
      cpuLimit: '4',
      memLimit: '8G',
      portStep: 20,
      tz: 'UTC',
      openclawImage: 'openclaw:local',
      enableNpmPackages: true,
    });

    const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('count');
    expect(res.json()).not.toHaveProperty('configBase');
    expect(res.json()).not.toHaveProperty('workspaceBase');
    expect(res.json().portStep).toBeTypeOf('number');
    expect(res.json().enableNpmPackages).toBeTypeOf('boolean');
  });

  it('PUT /api/config/fleet writes config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_URL: 'https://new.api.com', BASE_DIR: '/srv/openclaw' },
    });
    expect(res.statusCode).toBe(409);
    expect(mockFleetConfig.updateBaseDir).not.toHaveBeenCalled();
  });

  it('PUT /api/config/fleet preserves hidden env values when saving visible fields', async () => {
    mockBackend.getCachedStatus.mockReturnValueOnce({
      mode: 'hybrid',
      instances: [{ id: 'research-bot', runtime: 'hermes', mode: 'profile', runtimeCapabilities: configEditorCapabilities }],
      totalRunning: 1,
      updatedAt: Date.now(),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { TZ: 'Asia/Shanghai' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.writeFleetConfig).toHaveBeenCalledWith(expect.objectContaining({
      API_KEY: 'sk-test123',
      BASE_URL: 'https://api.example.com',
      TZ: 'Asia/Shanghai',
    }));
  });

  it('PUT /api/config/fleet allows baseDir changes when no docker instances exist', async () => {
    mockBackend.getCachedStatus.mockReturnValueOnce({
      mode: 'hybrid',
      instances: [{ id: 'research-bot', runtime: 'hermes', mode: 'profile', runtimeCapabilities: configEditorCapabilities }],
      totalRunning: 1,
      updatedAt: Date.now(),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_DIR: '/srv/openclaw', TZ: 'Asia/Shanghai' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.updateBaseDir).toHaveBeenCalledWith('/srv/openclaw', { applyImmediately: true });
  });

  it('PUT /api/config/fleet allows baseDir changes when only Hermes docker instances exist', async () => {
    mockBackend.getCachedStatus.mockReturnValueOnce({
      mode: 'hybrid',
      instances: [{ id: 'hermes-lab', runtime: 'hermes', mode: 'docker', runtimeCapabilities: configEditorCapabilities }],
      totalRunning: 1,
      updatedAt: Date.now(),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_DIR: '/srv/openclaw', TZ: 'Asia/Shanghai' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.updateBaseDir).toHaveBeenCalledWith('/srv/openclaw', { applyImmediately: true });
  });

  it('PUT /api/config/fleet rejects baseDir changes when docker availability cannot be verified', async () => {
    const getCachedStatus = vi.fn(() => null);
    const refresh = vi.fn(async () => {
      throw new Error('docker unavailable');
    });
    (app as any).backend.getCachedStatus = getCachedStatus;
    (app as any).backend.refresh = refresh;

    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_DIR: '/srv/openclaw', TZ: 'Asia/Shanghai' },
    });

    expect(mockFleetConfig.readFleetConfig).toHaveBeenCalled();
    expect(mockFleetConfig.readFleetConfig.mock.results.at(-1)?.value.baseDir).toBe('/tmp/managed');
    expect(mockFleetConfig.updateBaseDir).not.toHaveBeenCalled();
    expect(getCachedStatus).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('BASE_DIR_UNVERIFIED');
    expect(mockFleetConfig.updateBaseDir).not.toHaveBeenCalled();
    (app as any).backend.getCachedStatus = mockBackend.getCachedStatus;
    (app as any).backend.refresh = mockBackend.refresh;
  });

  it.each(['openclaw-1', 'openclaw-profile', 'hermes-lab', 'research-bot'])(
    'GET /api/fleet/:id/config returns instance config for %s',
    async (id) => {
      const res = await app.inject({ method: 'GET', url: `/api/fleet/${id}/config` });
      expect(res.statusCode).toBe(200);
      expect(res.json().gateway.mode).toBe('token');
      expect(mockBackend.readInstanceConfig).toHaveBeenCalledWith(id);
    },
  );

  it.each(['openclaw-1', 'openclaw-profile', 'hermes-lab', 'research-bot'])(
    'PUT /api/fleet/:id/config writes instance config for %s',
    async (id) => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/fleet/${id}/config`,
        payload: { gateway: { mode: 'local' } },
      });
      expect(res.statusCode).toBe(200);
      expect(mockBackend.writeInstanceConfig).toHaveBeenCalledWith(id, { gateway: { mode: 'local' } });
    },
  );

  it('PUT /api/config/fleet rejects non-string values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { COUNT: 5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_BODY');
  });

  it('rejects invalid docker instance id on GET config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/BAD_ID/config' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });

  it('rejects invalid docker instance id on PUT config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/fleet/BAD_ID/config',
      payload: { key: 'value' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
