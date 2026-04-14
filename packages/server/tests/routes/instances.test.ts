import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { instanceRoutes } from '../../src/routes/instances.js';

const openclawCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: true,
  sessions: true,
  plugins: true,
  runtimeAdmin: true,
} as const;

const hermesCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
} as const;

const openclawDockerInstance = {
  id: 'openclaw-1',
  runtime: 'openclaw' as const,
  mode: 'docker' as const,
  runtimeCapabilities: openclawCapabilities,
  index: 1,
  status: 'running',
  port: 18789,
  token: 'abc1***f456',
  uptime: 100,
  cpu: 12,
  memory: { used: 400, limit: 8000 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy',
  image: 'openclaw:local',
};

const openclawProfileInstance = {
  ...openclawDockerInstance,
  id: 'team-alpha',
  mode: 'profile' as const,
};

const hermesDockerInstance = {
  ...openclawDockerInstance,
  id: 'hermes-lab',
  runtime: 'hermes' as const,
  mode: 'docker' as const,
  runtimeCapabilities: hermesCapabilities,
  image: 'hermes:local',
};

const mockFleetStatus = {
  mode: 'hybrid' as const,
  instances: [
    openclawDockerInstance,
    openclawProfileInstance,
    hermesDockerInstance,
  ],
  totalRunning: 3,
  updatedAt: Date.now(),
};

const mockBackend = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  restart: vi.fn().mockResolvedValue(undefined),
  getCachedStatus: vi.fn().mockReturnValue(mockFleetStatus),
  refresh: vi.fn().mockResolvedValue(mockFleetStatus),
  revealToken: vi.fn().mockResolvedValue('full-token-abc123def456'),
  execInstanceCommand: vi.fn().mockResolvedValue(''),
};

describe('Instance routes — hybrid fleet', () => {
  const app = Fastify();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBackend.getCachedStatus.mockReturnValue(mockFleetStatus);
    mockBackend.refresh.mockResolvedValue(mockFleetStatus);
  });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(instanceRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it.each(['openclaw-1', 'team-alpha', 'hermes-lab'])(
    'POST /api/fleet/:id/start calls backend.start for %s',
    async (id) => {
      const res = await app.inject({ method: 'POST', url: `/api/fleet/${id}/start` });
      expect(res.statusCode).toBe(200);
      expect(mockBackend.start).toHaveBeenCalledWith(id);
      expect(res.json().instance.id).toBe(id);
    },
  );

  it('POST /api/fleet/:id/stop calls backend.stop', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/stop' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.stop).toHaveBeenCalledWith('openclaw-1');
  });

  it('POST /api/fleet/:id/restart calls backend.restart', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/restart' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.restart).toHaveBeenCalledWith('openclaw-1');
  });

  it.each(['openclaw-1', 'team-alpha', 'hermes-lab'])(
    'POST /api/fleet/:id/token/reveal returns token for %s',
    async (id) => {
      const res = await app.inject({ method: 'POST', url: `/api/fleet/${id}/token/reveal` });
      expect(res.statusCode).toBe(200);
      expect(res.json().token).toBe('full-token-abc123def456');
    },
  );

  it('POST /api/fleet/:id/token/reveal emits an audit log entry', async () => {
    const loggedMessages: object[] = [];
    const spy = vi.spyOn(app.log, 'info').mockImplementation((obj: unknown) => {
      if (obj && typeof obj === 'object') loggedMessages.push(obj as object);
    });

    await app.inject({ method: 'POST', url: '/api/fleet/openclaw-1/token/reveal' });

    spy.mockRestore();
    const auditEntry = loggedMessages.find((m: any) => m.audit === true);
    expect(auditEntry).toBeDefined();
    expect((auditEntry as any).event).toBe('token_revealed');
    expect((auditEntry as any).instance).toBe('openclaw-1');
    expect((auditEntry as any).username).toBe('admin');
    expect((auditEntry as any).ip).toBeTruthy();
    expect(JSON.stringify(auditEntry)).not.toContain('full-token-abc123def456');
  });

  it('accepts named docker instance ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/team-alpha/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('team-alpha');
  });

  it('GET /api/fleet/:id/devices/pending rejects Hermes runtime actions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/hermes-lab/devices/pending' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "hermes-lab" does not support this action',
      code: 'UNSUPPORTED_RUNTIME_ACTION',
    });
    expect(mockBackend.execInstanceCommand).not.toHaveBeenCalled();
  });

  it('GET /api/fleet/:id/devices/pending allows OpenClaw runtime actions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/devices/pending' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith('openclaw-1', ['devices', 'list']);
  });

  it('GET /api/fleet/:id/feishu/pairing rejects Hermes runtime actions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/hermes-lab/feishu/pairing' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "hermes-lab" does not support this action',
      code: 'UNSUPPORTED_RUNTIME_ACTION',
    });
  });

  it('rejects invalid docker instance id', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/BAD_ID/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });

  it('accepts known profile instance ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/team-alpha/start' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.start).toHaveBeenCalledWith('team-alpha');
  });

  it('rejects malformed ids', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fleet/BAD_ID/start' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_ID');
  });
});
