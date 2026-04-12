import type { InstanceSessionRow, InstanceSessionsEntry } from '../../types';

export type StatusFilter = 'all' | 'active' | 'done' | 'error';
export type TimeFilter = 'today' | '24h' | '7d' | 'all';
export type SortCol = 'tokens' | 'cost' | 'updated';
export type SortDir = 'asc' | 'desc';
export type ActivityViewMode = 'board' | 'table';

export type FlatRow = { instanceId: string; session: InstanceSessionRow };

export type BoardColumnKey = 'running' | 'done' | 'failed' | 'killedTimeout' | 'other';

export type BoardColumn = {
  key: BoardColumnKey;
  rows: FlatRow[];
};

export function buildFlatRows(instances: InstanceSessionsEntry[]): FlatRow[] {
  return instances.flatMap((entry) =>
    entry.sessions.map((session) => ({ instanceId: entry.instanceId, session })),
  );
}

export function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

export function sessionTimestamp(session: InstanceSessionRow): number | undefined {
  return session.updatedAt ?? session.endedAt ?? session.startedAt;
}

export function formatTokens(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatCost(n: number | undefined): string {
  if (n == null) return '$—';
  return `$${n.toFixed(2)}`;
}

export function formatRelative(ts: number | undefined, now = Date.now()): string {
  if (ts == null) return '—';
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

export function filterRows(
  rows: FlatRow[],
  status: StatusFilter,
  time: TimeFilter,
  now = Date.now(),
): FlatRow[] {
  return rows.filter(
    (row) => statusMatches(row.session, status) && timeMatches(row.session, time, now),
  );
}

export function sortRows(rows: FlatRow[], sortCol: SortCol | null, sortDir: SortDir): FlatRow[] {
  const copy = [...rows];

  if (sortCol === 'tokens') {
    return copy.sort((a, b) =>
      compareNumbers(a.session.totalTokens ?? -1, b.session.totalTokens ?? -1, sortDir),
    );
  }

  if (sortCol === 'cost') {
    return copy.sort((a, b) =>
      compareNumbers(a.session.estimatedCostUsd ?? -1, b.session.estimatedCostUsd ?? -1, sortDir),
    );
  }

  const direction = sortCol === 'updated' ? sortDir : 'desc';
  return copy.sort((a, b) =>
    compareNumbers(sessionTimestamp(a.session) ?? 0, sessionTimestamp(b.session) ?? 0, direction),
  );
}

export function buildBoardColumns(rows: FlatRow[]): BoardColumn[] {
  const grouped: Record<BoardColumnKey, FlatRow[]> = {
    running: [],
    done: [],
    failed: [],
    killedTimeout: [],
    other: [],
  };

  for (const row of rows) {
    grouped[columnKeyForStatus(row.session.status)].push(row);
  }

  return (Object.entries(grouped) as [BoardColumnKey, FlatRow[]][])
    .filter(([key, value]) => key !== 'other' || value.length > 0)
    .map(([key, value]) => ({ key, rows: value }));
}

export function summarizeRows(rows: FlatRow[]) {
  return {
    totalSessions: rows.length,
    totalTokens: rows.reduce((sum, row) => sum + (row.session.totalTokens ?? 0), 0),
    totalCost: rows.reduce((sum, row) => sum + (row.session.estimatedCostUsd ?? 0), 0),
    hasCostData: rows.some((row) => row.session.estimatedCostUsd != null),
  };
}

export function columnLabelKey(column: BoardColumnKey): string {
  if (column === 'running') return 'activityBoardRunning';
  if (column === 'done') return 'activityBoardDone';
  if (column === 'failed') return 'activityBoardFailed';
  if (column === 'killedTimeout') return 'activityBoardKilledTimeout';
  return 'activityBoardOther';
}

function statusMatches(session: InstanceSessionRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return session.status === 'running';
  if (filter === 'done') return session.status === 'done';
  return session.status === 'failed' || session.status === 'killed' || session.status === 'timeout';
}

function timeMatches(session: InstanceSessionRow, filter: TimeFilter, now: number): boolean {
  if (filter === 'all') return true;

  const ts = sessionTimestamp(session);
  if (ts == null) return false;

  if (filter === 'today') {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return ts >= startOfDay.getTime();
  }

  if (filter === '24h') return ts >= now - 86_400_000;
  if (filter === '7d') return ts >= now - 7 * 86_400_000;
  return true;
}

function columnKeyForStatus(status: InstanceSessionRow['status']): BoardColumnKey {
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'killed' || status === 'timeout') return 'killedTimeout';
  return 'other';
}

function compareNumbers(a: number, b: number, sortDir: SortDir): number {
  const diff = a - b;
  return sortDir === 'asc' ? diff : -diff;
}
