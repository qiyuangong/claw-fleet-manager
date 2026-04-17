import { mkdtempSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  SessionHistoryService,
  type SessionHistoryListQuery,
} from '../../src/services/session-history.js';
import type { InstanceSessionRow } from '../../src/services/openclaw-client.js';

type FixtureSessionOverrides = Partial<InstanceSessionRow> & Pick<InstanceSessionRow, 'key'>;

function makeSession(overrides: FixtureSessionOverrides): InstanceSessionRow {
  return {
    key: overrides.key,
    status: 'running',
    startedAt: 1_700_000_000_000,
    endedAt: undefined,
    runtimeMs: 60_000,
    model: 'gpt-5.4',
    modelProvider: 'openai',
    kind: 'chat',
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    estimatedCostUsd: 0.12,
    label: 'Label',
    displayName: 'Display Name',
    derivedTitle: 'Derived Title',
    lastMessagePreview: 'hello world',
    updatedAt: 1_700_000_010_000,
    ...overrides,
  };
}

function collectQuery(overrides: Partial<SessionHistoryListQuery> = {}): SessionHistoryListQuery {
  return {
    limit: 200,
    ...overrides,
  };
}

function createService() {
  const dir = mkdtempSync(join(tmpdir(), 'session-history-'));
  const dbPath = join(dir, 'sessions.sqlite');
  const service = new SessionHistoryService({ dbPath });
  return { dir, dbPath, service };
}

describe('SessionHistoryService', () => {
  it('creates schema and records the initial user_version migration', () => {
    const { dbPath, dir, service } = createService();
    service.close();

    const db = new Database(dbPath, { readonly: true });
    const row = Number(db.pragma('user_version', { simple: true }) ?? 0);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").all();

    db.close();
    rmSync(dir, { recursive: true, force: true });

    expect(row).toBe(1);
    expect(tables).toEqual([{ name: 'sessions' }]);
  });

  it('upserts by instance/session key and preserves first_seen_at across repeated captures', () => {
    const { dir, service } = createService();

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 1_000,
      sessions: [
        makeSession({
          key: 'run-1',
          status: 'running',
          derivedTitle: 'First title',
          lastMessagePreview: 'first preview',
        }),
      ],
    });

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 2_000,
      sessions: [
        makeSession({
          key: 'run-1',
          status: 'running',
          derivedTitle: 'Updated title',
          lastMessagePreview: 'updated preview',
          totalTokens: 240,
        }),
      ],
    });

    const page = service.listSessions(collectQuery());
    const count = service.countSessions(collectQuery());

    service.close();
    rmSync(dir, { recursive: true, force: true });

    expect(count).toBe(1);
    expect(page.nextCursor).toBeUndefined();
    expect(page.instances).toHaveLength(1);
    expect(page.instances[0].sessions).toEqual([
      expect.objectContaining({
        key: 'run-1',
        derivedTitle: 'Updated title',
        lastMessagePreview: 'updated preview',
        totalTokens: 240,
        updatedAt: 2_000,
      }),
    ]);
  });

  it('does not overwrite a session after the stored row becomes terminal', () => {
    const { dir, service } = createService();

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 3_000,
      sessions: [
        makeSession({
          key: 'done-1',
          status: 'done',
          endedAt: 2_900,
          runtimeMs: 900,
          derivedTitle: 'Terminal session',
        }),
      ],
    });

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 6_000,
      sessions: [
        makeSession({
          key: 'done-1',
          status: 'running',
          derivedTitle: 'Mutated title',
          lastMessagePreview: 'should be ignored',
          totalTokens: 999,
        }),
      ],
    });

    const stored = service.listSessions(collectQuery()).instances[0]?.sessions[0];

    service.close();
    rmSync(dir, { recursive: true, force: true });

    expect(stored).toEqual(expect.objectContaining({
      key: 'done-1',
      status: 'done',
      derivedTitle: 'Terminal session',
      updatedAt: 3_000,
      totalTokens: 120,
    }));
  });

  it('filters by time window, instance, status aliases, and LIKE search while returning a count estimate', () => {
    const { dir, service } = createService();

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 10_000,
      sessions: [
        makeSession({
          key: 'run-1',
          status: 'running',
          derivedTitle: 'Alpha running task',
          lastMessagePreview: 'focus query',
        }),
      ],
    });
    service.upsertSessions({
      instanceId: 'beta',
      seenAt: 20_000,
      sessions: [
        makeSession({
          key: 'fail-1',
          status: 'failed',
          derivedTitle: 'Beta failed task',
          lastMessagePreview: 'other preview',
        }),
      ],
    });
    service.upsertSessions({
      instanceId: 'beta',
      seenAt: 30_000,
      sessions: [
        makeSession({
          key: 'done-1',
          status: 'done',
          derivedTitle: 'Beta done task',
          lastMessagePreview: 'focus query',
        }),
      ],
    });

    const active = service.listSessions(collectQuery({
      from: 5_000,
      to: 25_000,
      status: 'active',
      instanceId: 'alpha',
      q: 'focus',
    }));
    const errors = service.listSessions(collectQuery({ status: 'error' }));
    const errorCount = service.countSessions(collectQuery({ status: 'error' }));

    service.close();
    rmSync(dir, { recursive: true, force: true });

    expect(active.instances).toHaveLength(1);
    expect(active.instances[0].instanceId).toBe('alpha');
    expect(active.instances[0].sessions.map((session) => session.key)).toEqual(['run-1']);
    expect(errors.instances[0].sessions.map((session) => session.key)).toEqual(['fail-1']);
    expect(errorCount).toBe(1);
  });

  it('returns stable keyset pagination cursors ordered by last_seen_at desc then identity', () => {
    const { dir, service } = createService();

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 30_000,
      sessions: [makeSession({ key: 'a-1', derivedTitle: 'Newest' })],
    });
    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 20_000,
      sessions: [makeSession({ key: 'a-2', derivedTitle: 'Middle alpha' })],
    });
    service.upsertSessions({
      instanceId: 'beta',
      seenAt: 20_000,
      sessions: [makeSession({ key: 'b-1', derivedTitle: 'Middle beta' })],
    });

    const firstPage = service.listSessions(collectQuery({ limit: 2 }));
    const secondPage = service.listSessions(collectQuery({ limit: 2, cursor: firstPage.nextCursor }));

    service.close();
    rmSync(dir, { recursive: true, force: true });

    expect(firstPage.instances.flatMap((entry) => entry.sessions.map((session) => `${entry.instanceId}:${session.key}`))).toEqual([
      'alpha:a-1',
      'alpha:a-2',
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.instances.flatMap((entry) => entry.sessions.map((session) => `${entry.instanceId}:${session.key}`))).toEqual([
      'beta:b-1',
    ]);
  });

  it('prunes rows older than the retention cutoff', () => {
    const { dir, service } = createService();

    service.upsertSessions({
      instanceId: 'alpha',
      seenAt: 10_000,
      sessions: [makeSession({ key: 'old-1' })],
    });
    service.upsertSessions({
      instanceId: 'beta',
      seenAt: 40_000,
      sessions: [makeSession({ key: 'new-1' })],
    });

    const deleted = service.pruneOlderThan(20_000);
    const page = service.listSessions(collectQuery());

    service.close();
    rmSync(dir, { recursive: true, force: true });

    expect(deleted).toBe(1);
    expect(page.instances.flatMap((entry) => entry.sessions.map((session) => session.key))).toEqual(['new-1']);
  });
});
