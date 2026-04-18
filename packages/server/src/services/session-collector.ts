import type { DeploymentBackend } from './backend.js';
import { fetchInstanceSessions, type InstanceSessionRow } from './openclaw-client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type HistoryLike = {
  upsertSessions(input: { instanceId: string; seenAt: number; sessions: InstanceSessionRow[] }): void;
  pruneOlderThan(cutoffMs: number): number;
  vacuum(): void;
};

type LoggerLike = {
  warn(message: string, error?: unknown): void;
};

type FetchSessions = typeof fetchInstanceSessions;

export class SessionCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private runningTick: Promise<void> | null = null;
  private lastVacuumAt: number | null = null;
  private readonly terminalKeys = new Map<string, number>();

  constructor(private readonly options: {
    backend: Pick<DeploymentBackend, 'getCachedStatus' | 'revealToken'>;
    history: HistoryLike;
    collectIntervalMs: number;
    activeMinutes: number;
    retentionDays: number;
    fetchSessions?: FetchSessions;
    log: LoggerLike;
    now?: () => number;
  }) {}

  async start() {
    if (this.timer) {
      return;
    }
    await this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.collectIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (this.runningTick) {
      return this.runningTick;
    }

    this.runningTick = this.collectOnce().finally(() => {
      this.runningTick = null;
    });
    return this.runningTick;
  }

  private async collectOnce() {
    const now = this.options.now?.() ?? Date.now();
    const status = this.options.backend.getCachedStatus();
    const runningInstances = (status?.instances ?? []).filter((instance) =>
      instance.status === 'running'
      && instance.runtime === 'openclaw'
      && instance.runtimeCapabilities.sessions,
    );
    const fetchSessions = this.options.fetchSessions ?? fetchInstanceSessions;

    const results = await Promise.allSettled(runningInstances.map(async (instance) => {
      const token = await this.options.backend.revealToken(instance.id);
      const sessions = await fetchSessions(instance.port, token, 5_000, {
        activeMinutes: this.options.activeMinutes,
        previewLimit: 0,
      });
      const nextSessions = sessions.filter((session) => {
        const key = `${instance.id}:${session.key}`;
        if (this.terminalKeys.has(key)) {
          this.terminalKeys.set(key, now);
          return false;
        }
        return true;
      });
      for (const session of nextSessions) {
        if (session.status && session.status !== 'running') {
          this.terminalKeys.set(`${instance.id}:${session.key}`, now);
        }
      }
      this.options.history.upsertSessions({
        instanceId: instance.id,
        seenAt: now,
        sessions: nextSessions,
      });
    }));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        return;
      }
      this.options.log.warn(
        `Failed to collect session history for ${runningInstances[index]?.id ?? 'unknown instance'}`,
        result.reason,
      );
    });

    try {
      this.options.history.pruneOlderThan(now - this.options.retentionDays * DAY_MS);
    } catch (error) {
      this.options.log.warn('Failed to prune session history', error);
    }
    this.pruneTerminalKeys(now);

    if (this.lastVacuumAt == null) {
      this.lastVacuumAt = now;
      return;
    }
    if (now - this.lastVacuumAt < DAY_MS) {
      return;
    }

    try {
      this.options.history.vacuum();
      this.lastVacuumAt = now;
    } catch (error) {
      this.options.log.warn('Failed to vacuum session history', error);
    }
  }

  private pruneTerminalKeys(now: number) {
    const cutoff = now - this.options.retentionDays * DAY_MS;
    for (const [key, lastSeenAt] of this.terminalKeys) {
      if (lastSeenAt <= cutoff) {
        this.terminalKeys.delete(key);
      }
    }
  }
}
