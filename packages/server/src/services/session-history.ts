import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { InstanceSessionRow } from './openclaw-client.js';

const CURRENT_USER_VERSION = 1;
const TERMINAL_STATUSES = new Set(['done', 'failed', 'killed', 'timeout']);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;

export type SessionHistoryStatusFilter =
  | 'running'
  | 'done'
  | 'failed'
  | 'killed'
  | 'timeout'
  | 'active'
  | 'error';

export type SessionHistoryListQuery = {
  from?: number;
  to?: number;
  status?: SessionHistoryStatusFilter;
  instanceId?: string;
  q?: string;
  limit?: number;
  cursor?: string;
};

type SessionHistoryRow = {
  instance_id: string;
  session_key: string;
  status: NonNullable<InstanceSessionRow['status']>;
  started_at: number | null;
  ended_at: number | null;
  runtime_ms: number | null;
  model: string | null;
  model_provider: string | null;
  kind: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  label: string | null;
  display_name: string | null;
  derived_title: string | null;
  last_message_preview: string | null;
  first_seen_at: number;
  last_seen_at: number;
  updated_at: number;
};

type SessionCursor = {
  lastSeenAt: number;
  instanceId: string;
  sessionKey: string;
};

type ExistingStatusRow = {
  status: string;
};

type StatementInput = {
  instance_id: string;
  session_key: string;
  status: NonNullable<InstanceSessionRow['status']>;
  started_at: number | null;
  ended_at: number | null;
  runtime_ms: number | null;
  model: string | null;
  model_provider: string | null;
  kind: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  label: string | null;
  display_name: string | null;
  derived_title: string | null;
  last_message_preview: string | null;
  first_seen_at: number;
  last_seen_at: number;
  updated_at: number;
};

type UpdateStatementInput = Omit<StatementInput, 'first_seen_at'>;

export type SessionHistoryEntry = {
  instanceId: string;
  sessions: InstanceSessionRow[];
  error?: string;
};

type ListResult = {
  instances: SessionHistoryEntry[];
  nextCursor?: string;
};

type DatabaseLike = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
  pragma?(source: string, options?: { simple?: boolean }): unknown;
  transaction<T extends (...args: any[]) => unknown>(fn: T): T;
};

type StatementLike = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
};

function isTerminalStatus(status: string | undefined): status is 'done' | 'failed' | 'killed' | 'timeout' {
  return status != null && TERMINAL_STATUSES.has(status);
}

function encodeCursor(cursor: SessionCursor): string {
  return Buffer.from(
    `${cursor.lastSeenAt}:${cursor.instanceId}:${cursor.sessionKey}`,
    'utf8',
  ).toString('base64');
}

function decodeCursor(cursor: string): SessionCursor {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const firstColon = raw.indexOf(':');
  const secondColon = raw.indexOf(':', firstColon + 1);
  if (firstColon <= 0 || secondColon <= firstColon + 1) {
    throw new Error('Invalid cursor');
  }

  const lastSeenAt = Number(raw.slice(0, firstColon));
  const instanceId = raw.slice(firstColon + 1, secondColon);
  const sessionKey = raw.slice(secondColon + 1);
  if (!Number.isFinite(lastSeenAt) || !instanceId || !sessionKey) {
    throw new Error('Invalid cursor');
  }

  return { lastSeenAt, instanceId, sessionKey };
}

function normalizeStatusFilter(status: SessionHistoryStatusFilter | undefined): string[] | null {
  if (!status) return null;
  if (status === 'active') return ['running'];
  if (status === 'error') return ['failed', 'killed', 'timeout'];
  return [status];
}

function buildWhereClause(query: SessionHistoryListQuery, includeCursor: boolean): {
  whereSql: string;
  params: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.from != null) {
    clauses.push('last_seen_at >= @from');
    params.from = query.from;
  }
  if (query.to != null) {
    clauses.push('last_seen_at <= @to');
    params.to = query.to;
  }
  if (query.instanceId) {
    clauses.push('instance_id = @instanceId');
    params.instanceId = query.instanceId;
  }

  const statuses = normalizeStatusFilter(query.status);
  if (statuses) {
    const names = statuses.map((status, index) => {
      const key = `status${index}`;
      params[key] = status;
      return `@${key}`;
    });
    clauses.push(`status IN (${names.join(', ')})`);
  }

  if (query.q?.trim()) {
    params.search = `%${query.q.trim()}%`;
    clauses.push(`(
      session_key LIKE @search COLLATE NOCASE
      OR display_name LIKE @search COLLATE NOCASE
      OR derived_title LIKE @search COLLATE NOCASE
      OR model LIKE @search COLLATE NOCASE
      OR kind LIKE @search COLLATE NOCASE
      OR last_message_preview LIKE @search COLLATE NOCASE
    )`);
  }

  if (includeCursor && query.cursor) {
    const cursor = decodeCursor(query.cursor);
    clauses.push(`(
      last_seen_at < @cursorLastSeenAt
      OR (last_seen_at = @cursorLastSeenAt AND instance_id > @cursorInstanceId)
      OR (
        last_seen_at = @cursorLastSeenAt
        AND instance_id = @cursorInstanceId
        AND session_key > @cursorSessionKey
      )
    )`);
    params.cursorLastSeenAt = cursor.lastSeenAt;
    params.cursorInstanceId = cursor.instanceId;
    params.cursorSessionKey = cursor.sessionKey;
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function mapRow(row: SessionHistoryRow): InstanceSessionRow {
  return {
    key: row.session_key,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    runtimeMs: row.runtime_ms ?? undefined,
    model: row.model ?? undefined,
    modelProvider: row.model_provider ?? undefined,
    kind: row.kind ?? undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    totalTokens: row.total_tokens ?? undefined,
    estimatedCostUsd: row.estimated_cost_usd ?? undefined,
    label: row.label ?? undefined,
    displayName: row.display_name ?? undefined,
    derivedTitle: row.derived_title ?? undefined,
    lastMessagePreview: row.last_message_preview ?? undefined,
    updatedAt: row.last_seen_at,
  };
}

function createNodeSqliteCompat(dbPath: string): DatabaseLike {
  const db = new DatabaseSync(dbPath);

  return {
    close: () => db.close(),
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        all: (...params) => statement.all(...params as Parameters<typeof statement.all>),
        get: (...params) => statement.get(...params as Parameters<typeof statement.get>),
        run: (...params) => {
          const result = statement.run(...params as Parameters<typeof statement.run>);
          return { changes: Number(result.changes ?? 0) };
        },
      };
    },
    pragma: (source, options) => {
      const pragmaSql = source.trim().toUpperCase().startsWith('PRAGMA ')
        ? source.trim()
        : `PRAGMA ${source.trim()}`;
      const rows = db.prepare(pragmaSql).all();
      if (options?.simple) {
        const firstRow = rows[0] as Record<string, unknown> | undefined;
        if (!firstRow) return undefined;
        return Object.values(firstRow)[0];
      }
      return rows;
    },
    transaction: (fn) => ((...args: unknown[]) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }) as typeof fn,
  };
}

function openDatabase(dbPath: string): DatabaseLike {
  const require = createRequire(import.meta.url);
  try {
    const BetterSqlite3 = require('better-sqlite3') as new (path: string) => DatabaseLike;
    return new BetterSqlite3(dbPath);
  } catch {
    return createNodeSqliteCompat(dbPath);
  }
}

export class SessionHistoryService {
  private readonly db: DatabaseLike;
  private readonly selectExisting: StatementLike;
  private readonly insertRow: StatementLike;
  private readonly updateRow: StatementLike;
  private readonly pruneStatement: StatementLike;

  constructor(options: { dbPath: string }) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = openDatabase(options.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.runMigrations();
    this.selectExisting = this.db.prepare(
      'SELECT status FROM sessions WHERE instance_id = ? AND session_key = ?',
    );
    this.insertRow = this.db.prepare(`
      INSERT INTO sessions (
        instance_id,
        session_key,
        status,
        started_at,
        ended_at,
        runtime_ms,
        model,
        model_provider,
        kind,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost_usd,
        label,
        display_name,
        derived_title,
        last_message_preview,
        first_seen_at,
        last_seen_at,
        updated_at
      ) VALUES (
        @instance_id,
        @session_key,
        @status,
        @started_at,
        @ended_at,
        @runtime_ms,
        @model,
        @model_provider,
        @kind,
        @input_tokens,
        @output_tokens,
        @total_tokens,
        @estimated_cost_usd,
        @label,
        @display_name,
        @derived_title,
        @last_message_preview,
        @first_seen_at,
        @last_seen_at,
        @updated_at
      )
    `);
    this.updateRow = this.db.prepare(`
      UPDATE sessions
      SET
        status = @status,
        started_at = @started_at,
        ended_at = @ended_at,
        runtime_ms = @runtime_ms,
        model = @model,
        model_provider = @model_provider,
        kind = @kind,
        input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        total_tokens = @total_tokens,
        estimated_cost_usd = @estimated_cost_usd,
        label = @label,
        display_name = @display_name,
        derived_title = @derived_title,
        last_message_preview = @last_message_preview,
        last_seen_at = @last_seen_at,
        updated_at = @updated_at
      WHERE instance_id = @instance_id AND session_key = @session_key
    `);
    this.pruneStatement = this.db.prepare(
      'DELETE FROM sessions WHERE last_seen_at < ?',
    );
  }

  upsertSessions(input: { instanceId: string; sessions: InstanceSessionRow[]; seenAt: number }) {
    const transaction = this.db.transaction(({ instanceId, sessions, seenAt }: typeof input) => {
      for (const session of sessions) {
        const status = session.status ?? 'running';
        const existing = this.selectExisting.get(instanceId, session.key) as ExistingStatusRow | undefined;
        if (existing && isTerminalStatus(existing.status)) {
          continue;
        }

        const params: StatementInput = {
          instance_id: instanceId,
          session_key: session.key,
          status,
          started_at: session.startedAt ?? null,
          ended_at: session.endedAt ?? null,
          runtime_ms: session.runtimeMs ?? null,
          model: session.model ?? null,
          model_provider: session.modelProvider ?? null,
          kind: session.kind ?? null,
          input_tokens: session.inputTokens ?? null,
          output_tokens: session.outputTokens ?? null,
          total_tokens: session.totalTokens ?? null,
          estimated_cost_usd: session.estimatedCostUsd ?? null,
          label: session.label ?? null,
          display_name: session.displayName ?? null,
          derived_title: session.derivedTitle ?? null,
          last_message_preview: session.lastMessagePreview ?? null,
          first_seen_at: seenAt,
          last_seen_at: seenAt,
          updated_at: seenAt,
        };

        if (!existing) {
          this.insertRow.run(params);
          continue;
        }

        const updateParams: UpdateStatementInput = {
          instance_id: params.instance_id,
          session_key: params.session_key,
          status: params.status,
          started_at: params.started_at,
          ended_at: params.ended_at,
          runtime_ms: params.runtime_ms,
          model: params.model,
          model_provider: params.model_provider,
          kind: params.kind,
          input_tokens: params.input_tokens,
          output_tokens: params.output_tokens,
          total_tokens: params.total_tokens,
          estimated_cost_usd: params.estimated_cost_usd,
          label: params.label,
          display_name: params.display_name,
          derived_title: params.derived_title,
          last_message_preview: params.last_message_preview,
          last_seen_at: params.last_seen_at,
          updated_at: params.updated_at,
        };
        this.updateRow.run(updateParams);
      }
    });

    transaction(input);
  }

  listSessions(query: SessionHistoryListQuery = {}): ListResult {
    const limit = normalizeLimit(query.limit);
    const { whereSql, params } = buildWhereClause(query, true);
    const rawRows = this.db.prepare(`
      SELECT *
      FROM sessions
      ${whereSql}
      ORDER BY last_seen_at DESC, instance_id ASC, session_key ASC
      LIMIT @limit
    `).all({ ...params, limit: limit + 1 }) as SessionHistoryRow[];
    const hasMore = rawRows.length > limit;
    const rows = hasMore ? rawRows.slice(0, limit) : rawRows;

    const grouped = new Map<string, SessionHistoryEntry>();
    for (const row of rows) {
      const existing = grouped.get(row.instance_id);
      if (existing) {
        existing.sessions.push(mapRow(row));
        continue;
      }
      grouped.set(row.instance_id, {
        instanceId: row.instance_id,
        sessions: [mapRow(row)],
      });
    }

    const lastRow = rows.at(-1);
    return {
      instances: [...grouped.values()],
      ...(hasMore && lastRow ? {
        nextCursor: encodeCursor({
          lastSeenAt: lastRow.last_seen_at,
          instanceId: lastRow.instance_id,
          sessionKey: lastRow.session_key,
        }),
      } : {}),
    };
  }

  countSessions(query: SessionHistoryListQuery = {}): number {
    const { whereSql, params } = buildWhereClause(query, false);
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM sessions
      ${whereSql}
    `).get(params) as { count: number };
    return row.count;
  }

  pruneOlderThan(cutoffMs: number): number {
    const result = this.pruneStatement.run(cutoffMs);
    return result.changes;
  }

  vacuum() {
    this.db.exec('VACUUM');
  }

  close() {
    this.db.close();
  }

  private runMigrations() {
    const userVersion = Number(this.db.pragma?.('user_version', { simple: true }) ?? 0);
    if (userVersion >= CURRENT_USER_VERSION) {
      return;
    }

    this.db.transaction(() => {
      if (userVersion < 1) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS sessions (
            instance_id TEXT NOT NULL,
            session_key TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at INTEGER,
            ended_at INTEGER,
            runtime_ms INTEGER,
            model TEXT,
            model_provider TEXT,
            kind TEXT,
            input_tokens INTEGER,
            output_tokens INTEGER,
            total_tokens INTEGER,
            estimated_cost_usd REAL,
            label TEXT,
            display_name TEXT,
            derived_title TEXT,
            last_message_preview TEXT,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (instance_id, session_key)
          );
          CREATE INDEX IF NOT EXISTS sessions_last_seen_idx
            ON sessions (last_seen_at DESC);
          CREATE INDEX IF NOT EXISTS sessions_started_idx
            ON sessions (started_at DESC);
          CREATE INDEX IF NOT EXISTS sessions_status_last_seen_idx
            ON sessions (status, last_seen_at DESC);
          CREATE INDEX IF NOT EXISTS sessions_instance_last_seen_idx
            ON sessions (instance_id, last_seen_at DESC);
          PRAGMA user_version = 1;
        `);
      }
    })();
  }
}
