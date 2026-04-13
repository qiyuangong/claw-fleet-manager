import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorService } from '../../src/services/monitor.js';

const mockDocker = {
  listFleetContainers: vi.fn().mockResolvedValue([
    { name: 'openclaw-1', id: 'abc', state: 'running' },
  ]),
  getContainerStats: vi.fn().mockResolvedValue({
    cpu: 12.5,
    memory: { used: 420_000_000, limit: 8_000_000_000 },
  }),
  inspectContainer: vi.fn().mockResolvedValue({
    status: 'running',
    health: 'healthy',
    image: 'openclaw:local',
    uptime: 86400,
  }),
  getDiskUsage: vi.fn().mockResolvedValue({}),
};

const mockFleetConfig = {
  readTokens: vi.fn().mockReturnValue({ 1: 'abc123def456' }),
  readFleetConfig: vi.fn().mockReturnValue({ portStep: 20 }),
  getConfigBase: vi.fn().mockReturnValue('/tmp/config'),
  getWorkspaceBase: vi.fn().mockReturnValue('/tmp/workspace'),
};

describe('MonitorService', () => {
  let svc: MonitorService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new MonitorService(mockDocker as any, mockFleetConfig as any);
  });

  afterEach(() => {
    svc.stop();
  });

  it('builds fleet status from Docker state', async () => {
    const status = await svc.refresh();
    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('openclaw-1');
    expect(status.instances[0].cpu).toBe(12.5);
    expect(status.instances[0].status).toBe('running');
    expect(status.instances[0].token).toBe('abc1***f456');
    expect(status.instances[0].port).toBe(18789);
    expect(status.instances[0].runtime).toBe('openclaw');
    expect(status.instances[0].runtimeCapabilities.logs).toBe(true);
    expect(status.totalRunning).toBe(1);
  });

  it('returns cached status via getStatus()', async () => {
    await svc.refresh();
    const cached = svc.getStatus();
    expect(cached).not.toBeNull();
    expect(cached?.instances).toHaveLength(1);
  });

  it('populates tailscaleUrl from TailscaleService when provided', async () => {
    const mockTailscale = {
      getUrl: vi.fn().mockReturnValue('https://machine.tailnet.ts.net:8800'),
    };
    const svcWithTs = new MonitorService(
      mockDocker as any,
      mockFleetConfig as any,
      mockTailscale as any,
    );
    const status = await svcWithTs.refresh();
    expect(status.instances[0].tailscaleUrl).toBe('https://machine.tailnet.ts.net:8800');
    svcWithTs.stop();
  });

  it('omits tailscaleUrl when TailscaleService is null', async () => {
    const status = await svc.refresh(); // svc constructed without TailscaleService
    expect(status.instances[0].tailscaleUrl).toBeUndefined();
  });
});
