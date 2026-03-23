import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { fleetRoutes } from '../../src/routes/fleet.js';

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn((
    _file: string,
    _args: string[],
    _opts: unknown,
    callback?: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    callback?.(null, { stdout: '', stderr: '' });
  }),
}));

function installExecFileSuccessMock() {
  execFileMock.mockImplementation((
    _file: string,
    _args: string[],
    _opts: unknown,
    callback?: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    callback?.(null, { stdout: '', stderr: '' });
  });
}

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

const mockStatus = {
  instances: [
    {
      id: 'openclaw-1',
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
    },
  ],
  totalRunning: 1,
  updatedAt: Date.now(),
};

const mockMonitor = {
  getStatus: vi.fn().mockReturnValue(mockStatus),
  refresh: vi.fn().mockResolvedValue(mockStatus),
};
const mockComposeGen = { generate: vi.fn() };
const mockDocker = {
  stopContainer: vi.fn(),
  listFleetContainers: vi.fn().mockResolvedValue([]),
};
const mockTailscale = {
  allocatePorts: vi.fn().mockReturnValue(new Map()),
  teardown: vi.fn().mockResolvedValue(undefined),
  setup: vi.fn().mockResolvedValue('https://machine.tailnet.ts.net:8800'),
};
const mockFleetConfig = {
  readFleetConfig: vi.fn().mockReturnValue({ portStep: 20 }),
};

describe('Fleet routes', () => {
  const app = Fastify();

  beforeEach(() => {
    vi.clearAllMocks();
    execFileMock.mockReset();
    installExecFileSuccessMock();
    mockMonitor.getStatus.mockReturnValue(mockStatus);
    mockMonitor.refresh.mockResolvedValue(mockStatus);
    mockDocker.listFleetContainers.mockResolvedValue([]);
    mockTailscale.allocatePorts.mockReturnValue(new Map());
    mockFleetConfig.readFleetConfig.mockReturnValue({ portStep: 20 });
  });

  beforeAll(async () => {
    app.decorate('monitor', mockMonitor);
    app.decorate('composeGenerator', mockComposeGen);
    app.decorate('docker', mockDocker);
    app.decorate('fleetDir', '/tmp');
    app.decorate('tailscale', mockTailscale);
    app.decorate('tailscaleHostname', null);
    app.decorate('fleetConfig', mockFleetConfig);
    await app.register(fleetRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /api/fleet returns fleet status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/fleet' });
    expect(res.statusCode).toBe(200);
    expect(res.json().instances).toHaveLength(1);
    expect(res.json().totalRunning).toBe(1);
  });

  it('POST /api/fleet/scale rejects concurrent requests with 409', async () => {
    let releaseCompose: (() => void) | null = null;
    let resolveComposeStarted: (() => void) | null = null;
    const composeStarted = new Promise<void>((resolve) => {
      resolveComposeStarted = resolve;
    });

    execFileMock.mockImplementationOnce((
      _file: string,
      _args: string[],
      _opts: unknown,
      callback?: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
    ) => {
      resolveComposeStarted?.();
      releaseCompose = () => callback?.(null, { stdout: '', stderr: '' });
    });

    const first = app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } });
    await composeStarted;
    const second = await app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } });
    releaseCompose?.();
    const firstRes = await first;

    expect(second.statusCode).toBe(409);
    expect(firstRes.statusCode).toBe(200);
  });

  it('POST /api/fleet/scale validates count', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/fleet/scale with valid count attempts compose apply', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: 3 },
    });
    expect([200, 500]).toContain(res.statusCode);
    expect(mockComposeGen.generate).toHaveBeenCalledWith(3, undefined);
  });

  it('POST /api/fleet/scale removes compose orphans when scaling down', async () => {
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: '1', state: 'running' },
      { name: 'openclaw-2', id: '2', state: 'running' },
      { name: 'openclaw-3', id: '3', state: 'exited' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/fleet/scale',
      payload: { count: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(mockDocker.stopContainer).toHaveBeenCalledWith('openclaw-3');
    expect(execFileMock).toHaveBeenCalledWith(
      'docker',
      ['compose', 'up', '-d', '--remove-orphans'],
      { cwd: '/tmp' },
      expect.any(Function),
    );
  });

  describe('with Tailscale enabled', () => {
    const appTs = Fastify();
    const mockComposeGenTs = { generate: vi.fn() };
    const mockTailscaleTs = {
      allocatePorts: vi.fn().mockReturnValue(new Map([[1, 8800], [2, 8801], [3, 8802]])),
      teardown: vi.fn().mockResolvedValue(undefined),
      setup: vi.fn().mockResolvedValue('https://machine.ts.net:8800'),
    };

    beforeAll(async () => {
      appTs.decorate('monitor', { getStatus: vi.fn().mockReturnValue(mockStatus), refresh: vi.fn().mockResolvedValue(mockStatus) });
      appTs.decorate('composeGenerator', mockComposeGenTs);
      appTs.decorate('docker', { stopContainer: vi.fn(), listFleetContainers: vi.fn().mockResolvedValue([]) });
      appTs.decorate('fleetDir', '/tmp');
      appTs.decorate('tailscale', mockTailscaleTs);
      appTs.decorate('tailscaleHostname', 'machine.ts.net');
      appTs.decorate('fleetConfig', { readFleetConfig: vi.fn().mockReturnValue({ portStep: 20 }) });
      await appTs.register(fleetRoutes);
      await appTs.ready();
    });

    afterAll(() => appTs.close());

    it('POST /api/fleet/scale passes tailscaleConfig to generate when Tailscale is enabled', async () => {
      const res = await appTs.inject({
        method: 'POST',
        url: '/api/fleet/scale',
        payload: { count: 3 },
      });
      expect([200, 500]).toContain(res.statusCode);
      expect(mockComposeGenTs.generate).toHaveBeenCalledWith(
        3,
        expect.objectContaining({ hostname: 'machine.ts.net' }),
      );
    });
  });
});
