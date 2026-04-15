import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { pluginRoutes } from '../../src/routes/plugins.js';

const mockBackend = {
  execInstanceCommand: vi.fn(),
  getCachedStatus: vi.fn().mockReturnValue({
    instances: [
      {
        id: 'openclaw-1',
        runtime: 'openclaw',
        mode: 'docker',
        runtimeCapabilities: {
          configEditor: true,
          logs: true,
          rename: true,
          delete: true,
          proxyAccess: true,
          sessions: true,
          plugins: true,
          runtimeAdmin: true,
        },
      },
      {
        id: 'main',
        runtime: 'openclaw',
        mode: 'profile',
        runtimeCapabilities: {
          configEditor: true,
          logs: true,
          rename: true,
          delete: true,
          proxyAccess: true,
          sessions: true,
          plugins: true,
          runtimeAdmin: true,
        },
      },
      {
        id: 'hermes-lab',
        runtime: 'hermes',
        mode: 'docker',
        runtimeCapabilities: {
          configEditor: true,
          logs: true,
          rename: true,
          delete: true,
          proxyAccess: false,
          sessions: false,
          plugins: false,
          runtimeAdmin: true,
        },
      },
    ],
  }),
  refresh: vi.fn(),
};

describe('Plugin routes - hybrid mode', () => {
  const app = Fastify();

  beforeEach(() => {
    mockBackend.execInstanceCommand.mockReset();
    mockBackend.getCachedStatus.mockReset();
    mockBackend.refresh.mockReset();
    mockBackend.getCachedStatus.mockReturnValue({
      instances: [
        {
          id: 'openclaw-1',
          runtime: 'openclaw',
          mode: 'docker',
          runtimeCapabilities: {
            configEditor: true,
            logs: true,
            rename: true,
            delete: true,
            proxyAccess: true,
            sessions: true,
            plugins: true,
            runtimeAdmin: true,
          },
        },
        {
          id: 'team-alpha',
          runtime: 'openclaw',
          mode: 'docker',
          runtimeCapabilities: {
            configEditor: true,
            logs: true,
            rename: true,
            delete: true,
            proxyAccess: true,
            sessions: true,
            plugins: true,
            runtimeAdmin: true,
          },
        },
        {
          id: 'main',
          runtime: 'openclaw',
          mode: 'profile',
          runtimeCapabilities: {
            configEditor: true,
            logs: true,
            rename: true,
            delete: true,
            proxyAccess: true,
            sessions: true,
            plugins: true,
            runtimeAdmin: true,
          },
        },
        {
          id: 'hermes-lab',
          runtime: 'hermes',
          mode: 'docker',
          runtimeCapabilities: {
            configEditor: true,
            logs: true,
            rename: true,
            delete: true,
            proxyAccess: false,
            sessions: false,
            plugins: false,
            runtimeAdmin: true,
          },
        },
      ],
      totalRunning: 2,
      updatedAt: Date.now(),
    });
  });

  beforeAll(async () => {
    app.decorate('backend', mockBackend);
    app.addHook('onRequest', async (request) => {
      (request as any).user = { username: 'admin', role: 'admin', assignedProfiles: [] };
    });
    await app.register(pluginRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet/:id/plugins returns plugin list for Docker instance', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      JSON.stringify({ workspaceDir: '/tmp/ws', plugins: [{ id: 'feishu', enabled: true }] }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/plugins' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith('openclaw-1', ['plugins', 'list', '--json']);
    expect(res.json().plugins[0].id).toBe('feishu');
  });

  it('GET /api/fleet/:id/plugins rejects invalid Docker instance id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/invalid_id/plugins' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/fleet/:id/plugins accepts named Docker instance ids', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      JSON.stringify({ workspaceDir: '/tmp/ws', plugins: [] }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/team-alpha/plugins' });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith('team-alpha', ['plugins', 'list', '--json']);
  });

  it('POST /api/fleet/:id/plugins/install installs a plugin', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce('Installed plugin: feishu');
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/openclaw-1/plugins/install',
      payload: { spec: '@openclaw/feishu' },
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith(
      'openclaw-1',
      ['plugins', 'install', '@openclaw/feishu'],
    );
    expect(res.json().ok).toBe(true);
  });

  it('DELETE /api/fleet/:id/plugins/:pluginId uninstalls a plugin', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce('Removed plugin: feishu');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/fleet/openclaw-1/plugins/feishu',
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith(
      'openclaw-1',
      ['plugins', 'uninstall', '--force', 'feishu'],
    );
    expect(res.json().ok).toBe(true);
  });

  it('DELETE /api/fleet/:id/plugins/:pluginId accepts uppercase plugin ids', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce('Removed plugin: FeiShu');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/fleet/openclaw-1/plugins/FeiShu',
    });
    expect(res.statusCode).toBe(200);
    expect(mockBackend.execInstanceCommand).toHaveBeenCalledWith(
      'openclaw-1',
      ['plugins', 'uninstall', '--force', 'FeiShu'],
    );
    expect(res.json().ok).toBe(true);
  });

  it('GET tolerates CLI log lines before JSON output', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      '\u001b[35m[plugins]\u001b[0m feishu: Registered\n'
      + '{"workspaceDir":"/tmp/ws","plugins":[{"id":"feishu","enabled":true}]}',
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/openclaw-1/plugins' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plugins[0].id).toBe('feishu');
  });
  it('GET /api/fleet/:id/plugins works for profile instance id', async () => {
    mockBackend.execInstanceCommand.mockResolvedValueOnce(
      JSON.stringify({ workspaceDir: '/tmp/ws', plugins: [] }),
    );
    const res = await app.inject({ method: 'GET', url: '/api/fleet/main/plugins' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/fleet/:id/plugins rejects malformed ids', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/BAD_ID/plugins' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/fleet/:id/plugins rejects Hermes instances as unsupported', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet/hermes-lab/plugins' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "hermes-lab" does not support this action',
      code: 'UNSUPPORTED_RUNTIME_ACTION',
    });
    expect(mockBackend.execInstanceCommand).not.toHaveBeenCalled();
  });

  it('POST /api/fleet/:id/plugins/install rejects Hermes instances as unsupported', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/hermes-lab/plugins/install',
      payload: { spec: '@openclaw/feishu' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Instance "hermes-lab" does not support this action',
      code: 'UNSUPPORTED_RUNTIME_ACTION',
    });
    expect(mockBackend.execInstanceCommand).not.toHaveBeenCalled();
  });
});
