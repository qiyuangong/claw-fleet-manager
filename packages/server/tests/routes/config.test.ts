// packages/server/tests/routes/config.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { configRoutes } from '../../src/routes/config.js';

const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-***123',
    modelId: 'gpt-4',
    count: 3,
    cpuLimit: '4',
    memLimit: '8G',
    portStep: 20,
    configBase: '/tmp/instances',
    workspaceBase: '/tmp/workspaces',
    tz: 'UTC',
  }),
  writeFleetConfig: vi.fn(),
};

const mockBackend = {
  getCachedStatus: vi.fn().mockReturnValue({
    mode: 'docker',
    instances: [
      { id: 'openclaw-1' },
      { id: 'openclaw-2' },
    ],
    totalRunning: 2,
    updatedAt: Date.now(),
  }),
  readInstanceConfig: vi.fn().mockResolvedValue({ gateway: { mode: 'token' } }),
  writeInstanceConfig: vi.fn().mockResolvedValue(undefined),
};

describe('Config routes — docker mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'docker');
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
    expect(mockFleetConfig.readFleetConfig).toHaveBeenCalledWith(2);
  });

  it('PUT /api/config/fleet writes config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/fleet',
      payload: { BASE_URL: 'https://new.api.com', API_KEY: 'sk-new' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.writeFleetConfig).toHaveBeenCalled();
  });

  it('GET /api/fleet/:id/config returns instance config', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json().gateway.mode).toBe('token');
    expect(mockBackend.readInstanceConfig).toHaveBeenCalledWith('openclaw-1');
  });

  it('PUT /api/fleet/:id/config writes instance config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/fleet/openclaw-1/config',
      payload: { gateway: { mode: 'local' } },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.writeInstanceConfig).toHaveBeenCalledWith('openclaw-1', { gateway: { mode: 'local' } });
  });

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

describe('Config routes — profile mode', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('fleetConfig', mockFleetConfig);
    app.decorate('backend', mockBackend);
    app.decorate('deploymentMode', 'profiles');
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(configRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('accepts profile name as instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/main/config' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.readInstanceConfig).toHaveBeenCalledWith('main');
  });

  it('does not override count in profile mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config/fleet' });
    expect(res.statusCode).toBe(200);
    expect(mockFleetConfig.readFleetConfig).toHaveBeenCalledWith();
  });
});
