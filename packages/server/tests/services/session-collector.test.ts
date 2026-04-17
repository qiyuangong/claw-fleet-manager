import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DeploymentBackend } from '../../src/services/backend.js';
import { SessionCollector } from '../../src/services/session-collector.js';
import type { InstanceSessionRow } from '../../src/services/openclaw-client.js';

type HistoryRecorder = {
  upsertCalls: Array<{ instanceId: string; seenAt: number; sessions: InstanceSessionRow[] }>;
  pruneCalls: number[];
  vacuumCalls: number;
};

function runningInstance(id: string) {
  return {
    id,
    runtime: 'openclaw' as const,
    mode: 'docker' as const,
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
    status: 'running' as const,
    port: 18_789,
    token: 'masked',
    uptime: 0,
    cpu: 0,
    memory: { used: 0, limit: 0 },
    disk: { config: 0, workspace: 0 },
    health: 'healthy' as const,
    image: 'openclaw:local',
  };
}

function createHistoryRecorder(): HistoryRecorder & {
  upsertSessions: (input: { instanceId: string; seenAt: number; sessions: InstanceSessionRow[] }) => void;
  pruneOlderThan: (cutoffMs: number) => number;
  vacuum: () => void;
} {
  return {
    upsertCalls: [],
    pruneCalls: [],
    vacuumCalls: 0,
    upsertSessions(input) {
      this.upsertCalls.push(input);
    },
    pruneOlderThan(cutoffMs) {
      this.pruneCalls.push(cutoffMs);
      return 0;
    },
    vacuum() {
      this.vacuumCalls += 1;
    },
  };
}

describe('SessionCollector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs an immediate tick, fans out across running openclaw instances, and prunes every cycle', async () => {
    const history = createHistoryRecorder();
    const backend: Pick<DeploymentBackend, 'getCachedStatus' | 'revealToken'> = {
      getCachedStatus: vi.fn().mockReturnValue({
        instances: [
          runningInstance('alpha'),
          runningInstance('beta'),
          {
            ...runningInstance('hermes-lab'),
            runtime: 'hermes' as const,
            runtimeCapabilities: {
              ...runningInstance('tmp').runtimeCapabilities,
              sessions: false,
              proxyAccess: false,
              plugins: false,
            },
          },
        ],
        totalRunning: 3,
        updatedAt: Date.now(),
      }),
      revealToken: vi.fn().mockImplementation(async (id: string) => `${id}-token`),
    };
    const fetchSessions = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'run-1', status: 'running' } satisfies InstanceSessionRow])
      .mockRejectedValueOnce(new Error('instance offline'))
      .mockResolvedValue([{ key: 'run-1', status: 'running' } satisfies InstanceSessionRow]);
    const warn = vi.fn();
    const collector = new SessionCollector({
      backend,
      history,
      collectIntervalMs: 30_000,
      activeMinutes: 180,
      retentionDays: 30,
      fetchSessions,
      log: { warn } as { warn: (message: string, error?: unknown) => void },
    });

    await collector.start();

    expect(fetchSessions).toHaveBeenNthCalledWith(1, 18_789, 'alpha-token', 5_000, {
      activeMinutes: 180,
      previewLimit: 0,
    });
    expect(fetchSessions).toHaveBeenNthCalledWith(2, 18_789, 'beta-token', 5_000, {
      activeMinutes: 180,
      previewLimit: 0,
    });
    expect(history.upsertCalls).toHaveLength(1);
    expect(history.upsertCalls[0]).toEqual({
      instanceId: 'alpha',
      seenAt: Date.now(),
      sessions: [{ key: 'run-1', status: 'running' }],
    });
    expect(history.pruneCalls).toEqual([Date.now() - 30 * 86_400_000]);
    expect(warn).toHaveBeenCalledWith('Failed to collect session history for beta', expect.any(Error));

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchSessions).toHaveBeenCalledTimes(4);
    expect(history.upsertCalls).toHaveLength(3);
    expect(history.upsertCalls[2]).toEqual({
      instanceId: 'beta',
      seenAt: new Date('2026-04-17T00:00:30.000Z').getTime(),
      sessions: [{ key: 'run-1', status: 'running' }],
    });
    expect(history.pruneCalls).toHaveLength(2);

    collector.stop();
  });

  it('skips rewriting keys that were already observed in a terminal state', async () => {
    const history = createHistoryRecorder();
    const backend: Pick<DeploymentBackend, 'getCachedStatus' | 'revealToken'> = {
      getCachedStatus: vi.fn().mockReturnValue({
        instances: [runningInstance('alpha')],
        totalRunning: 1,
        updatedAt: Date.now(),
      }),
      revealToken: vi.fn().mockResolvedValue('alpha-token'),
    };
    const fetchSessions = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'done-1', status: 'done' } satisfies InstanceSessionRow])
      .mockResolvedValueOnce([
        { key: 'done-1', status: 'done' } satisfies InstanceSessionRow,
        { key: 'run-1', status: 'running' } satisfies InstanceSessionRow,
      ]);
    const collector = new SessionCollector({
      backend,
      history,
      collectIntervalMs: 30_000,
      activeMinutes: 180,
      retentionDays: 30,
      fetchSessions,
      log: { warn: vi.fn() } as { warn: () => void },
    });

    await collector.start();
    await vi.advanceTimersByTimeAsync(30_000);

    collector.stop();

    expect(history.upsertCalls).toEqual([
      {
        instanceId: 'alpha',
        seenAt: new Date('2026-04-17T00:00:00.000Z').getTime(),
        sessions: [{ key: 'done-1', status: 'done' }],
      },
      {
        instanceId: 'alpha',
        seenAt: new Date('2026-04-17T00:00:30.000Z').getTime(),
        sessions: [{ key: 'run-1', status: 'running' }],
      },
    ]);
  });

  it('does not invent a terminal status when a running session disappears on the next tick', async () => {
    const history = createHistoryRecorder();
    const backend: Pick<DeploymentBackend, 'getCachedStatus' | 'revealToken'> = {
      getCachedStatus: vi.fn().mockReturnValue({
        instances: [runningInstance('alpha')],
        totalRunning: 1,
        updatedAt: Date.now(),
      }),
      revealToken: vi.fn().mockResolvedValue('alpha-token'),
    };
    const fetchSessions = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'run-1', status: 'running' } satisfies InstanceSessionRow])
      .mockResolvedValueOnce([]);
    const collector = new SessionCollector({
      backend,
      history,
      collectIntervalMs: 30_000,
      activeMinutes: 180,
      retentionDays: 30,
      fetchSessions,
      log: { warn: vi.fn() } as { warn: () => void },
    });

    await collector.start();
    await vi.advanceTimersByTimeAsync(30_000);

    collector.stop();

    expect(history.upsertCalls).toHaveLength(2);
    expect(history.upsertCalls[0].sessions).toEqual([{ key: 'run-1', status: 'running' }]);
    expect(history.upsertCalls[1].sessions).toEqual([]);
  });

  it('vacuums at most once every 24 hours of ticks', async () => {
    const history = createHistoryRecorder();
    const backend: Pick<DeploymentBackend, 'getCachedStatus' | 'revealToken'> = {
      getCachedStatus: vi.fn().mockReturnValue({
        instances: [runningInstance('alpha')],
        totalRunning: 1,
        updatedAt: Date.now(),
      }),
      revealToken: vi.fn().mockResolvedValue('alpha-token'),
    };
    const fetchSessions = vi.fn().mockResolvedValue([{ key: 'run-1', status: 'running' } satisfies InstanceSessionRow]);
    const collector = new SessionCollector({
      backend,
      history,
      collectIntervalMs: 30_000,
      activeMinutes: 180,
      retentionDays: 30,
      fetchSessions,
      log: { warn: vi.fn() } as { warn: () => void },
    });

    await collector.start();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 30_000);
    expect(history.vacuumCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(history.vacuumCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(history.vacuumCalls).toBe(2);

    collector.stop();
  });
});
