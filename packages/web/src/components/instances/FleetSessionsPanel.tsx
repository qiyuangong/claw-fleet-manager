import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import type { InstanceSessionRow, InstanceSessionsEntry } from '../../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

function formatTokens(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatCost(n: number | undefined): string {
  if (n == null) return '$—';
  return `$${n.toFixed(2)}`;
}

function sessionTimestamp(session: InstanceSessionRow): number | undefined {
  return session.updatedAt ?? session.endedAt ?? session.startedAt;
}

function formatRelative(ts: number | undefined): string {
  if (ts == null) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── filter types ────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'done' | 'error';
type TimeFilter = 'today' | '24h' | '7d' | 'all';
type SortCol = 'tokens' | 'cost' | 'updated';
type SortDir = 'asc' | 'desc';

function statusMatches(session: InstanceSessionRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return session.status === 'running';
  if (filter === 'done') return session.status === 'done';
  if (filter === 'error') return session.status === 'failed' || session.status === 'killed' || session.status === 'timeout';
  return true;
}

function timeMatches(session: InstanceSessionRow, filter: TimeFilter): boolean {
  if (filter === 'all') return true;
  const ts = sessionTimestamp(session);
  if (ts == null) return false;
  const now = Date.now();
  if (filter === 'today') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return ts >= startOfDay.getTime();
  }
  if (filter === '24h') return ts >= now - 86_400_000;
  if (filter === '7d') return ts >= now - 7 * 86_400_000;
  return true;
}

// ─── flat row type ────────────────────────────────────────────────────────────

type FlatRow = { instanceId: string; session: InstanceSessionRow };

function buildFlatRows(instances: InstanceSessionsEntry[]): FlatRow[] {
  return instances.flatMap((entry) =>
    entry.sessions.map((session) => ({ instanceId: entry.instanceId, session }))
  );
}

// ─── SessionRow component ────────────────────────────────────────────────────

function SessionRow({ instanceId, session, onSelectInstance }: {
  instanceId: string;
  session: InstanceSessionRow;
  onSelectInstance: (id: string) => void;
}) {
  const statusDotClass =
    session.status === 'running' ? 'status-dot--running' :
    session.status === 'done' ? 'status-dot--done' :
    session.status != null ? 'status-dot--error' : 'status-dot--none';

  return (
    <tr className="session-table-row">
      <td><span className={`status-dot ${statusDotClass}`} /></td>
      <td>
        <button
          className="link-button"
          onClick={() => onSelectInstance(instanceId)}
        >
          {instanceId}
        </button>
      </td>
      <td title={sessionTitle(session)}>{truncate(sessionTitle(session), 40)}</td>
      <td>{session.kind ? <span className="pill pill--sm">{session.kind}</span> : '—'}</td>
      <td className="muted">{session.model ? truncate(session.model, 20) : '—'}</td>
      <td className="col-numeric">{formatTokens(session.totalTokens)}</td>
      <td className="col-numeric">{formatCost(session.estimatedCostUsd)}</td>
      <td className="muted col-preview">{session.lastMessagePreview ? truncate(session.lastMessagePreview, 60) : '—'}</td>
      <td className="muted col-numeric">{formatRelative(sessionTimestamp(session))}</td>
    </tr>
  );
}

// ─── SessionsTable component ──────────────────────────────────────────────────

function SessionsTable({ rows, onSelectInstance, sortCol, sortDir, onSort }: {
  rows: FlatRow[];
  onSelectInstance: (id: string) => void;
  sortCol: SortCol | null;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
}) {
  const { t } = useTranslation();

  function SortHeader({ col, label }: { col: SortCol; label: string }) {
    const active = sortCol === col;
    return (
      <th
        className={`sortable-th${active ? ' sortable-th--active' : ''}`}
        onClick={() => onSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <div className="sessions-table-wrap">
      <table className="sessions-table">
        <thead>
          <tr>
            <th style={{ width: '1.5rem' }} />
            <th>{t('colInstance')}</th>
            <th>{t('colSession')}</th>
            <th>{t('colType')}</th>
            <th>{t('colModel')}</th>
            <SortHeader col="tokens" label={t('colTokens')} />
            <SortHeader col="cost" label={t('colCost')} />
            <th>{t('colLastMessage')}</th>
            <SortHeader col="updated" label={t('colUpdated')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SessionRow
              key={`${row.instanceId}:${row.session.key}`}
              instanceId={row.instanceId}
              session={row.session}
              onSelectInstance={onSelectInstance}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── FleetSessionsPanel ───────────────────────────────────────────────────────

export function FleetSessionsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch, isFetching } = useFleetSessions();
  const selectInstance = useAppStore((state) => state.selectInstance);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  // Stats
  const allRows = useMemo(() => buildFlatRows(data?.instances ?? []), [data]);
  const totalTokens = useMemo(
    () => allRows.reduce((sum, r) => sum + (r.session.totalTokens ?? 0), 0),
    [allRows],
  );
  const totalCost = useMemo(
    () => allRows.reduce((sum, r) => sum + (r.session.estimatedCostUsd ?? 0), 0),
    [allRows],
  );

  // Filtered + sorted rows
  const filteredRows = useMemo(() => {
    let rows = allRows.filter(
      (r) => statusMatches(r.session, statusFilter) && timeMatches(r.session, timeFilter),
    );

    if (sortCol === 'tokens') {
      rows = [...rows].sort((a, b) => {
        const diff = (a.session.totalTokens ?? -1) - (b.session.totalTokens ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else if (sortCol === 'cost') {
      rows = [...rows].sort((a, b) => {
        const diff = (a.session.estimatedCostUsd ?? -1) - (b.session.estimatedCostUsd ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else if (sortCol === 'updated') {
      rows = [...rows].sort((a, b) => {
        const diff = (sessionTimestamp(a.session) ?? 0) - (sessionTimestamp(b.session) ?? 0);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else {
      // Default: newest-updated first
      rows = [...rows].sort(
        (a, b) => (sessionTimestamp(b.session) ?? 0) - (sessionTimestamp(a.session) ?? 0),
      );
    }

    return rows;
  }, [allRows, statusFilter, timeFilter, sortCol, sortDir]);

  // Error rows from instances that failed to fetch
  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((e) => !!e.error),
    [data],
  );

  const STATUS_FILTERS: { key: StatusFilter; labelKey: string }[] = [
    { key: 'all', labelKey: 'statusFilterAll' },
    { key: 'active', labelKey: 'statusFilterActive' },
    { key: 'done', labelKey: 'statusFilterDone' },
    { key: 'error', labelKey: 'statusFilterError' },
  ];

  const TIME_FILTERS: { key: TimeFilter; labelKey: string }[] = [
    { key: 'today', labelKey: 'timeFilterToday' },
    { key: '24h', labelKey: 'timeFilter24h' },
    { key: '7d', labelKey: 'timeFilter7d' },
    { key: 'all', labelKey: 'timeFilterAll' },
  ];

  return (
    <div className="field-grid">
      <section className="panel-card">
        {/* Header */}
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('activeSessions')}</h2>
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : t('refresh')}
          </button>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="sessions-stats-bar">
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('sessionsCount')}</span>
              <span className="sessions-stat-value">{allRows.length}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('tokens')}</span>
              <span className="sessions-stat-value">{formatTokens(totalTokens || undefined)}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('cost')}</span>
              <span className="sessions-stat-value">{formatCost(totalCost || undefined)}</span>
            </span>
          </div>
        )}

        {/* Filter row */}
        {data && (
          <div className="sessions-filter-row">
            <div className="filter-tabs">
              {STATUS_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  className={`filter-tab${statusFilter === key ? ' filter-tab--active' : ''}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {t(labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
            <div className="filter-tabs">
              {TIME_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  className={`filter-tab${timeFilter === key ? ' filter-tab--active' : ''}`}
                  onClick={() => setTimeFilter(key)}
                >
                  {t(labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {isLoading ? (
          <p className="muted">{t('loadingSessions')}</p>
        ) : error ? (
          <p className="error-text">{(error as Error).message}</p>
        ) : !data || allRows.length === 0 ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : (
          <>
            {errorEntries.map((entry) => (
              <p key={entry.instanceId} className="error-text" style={{ fontSize: '0.85rem' }}>
                ⚠ {entry.instanceId}: {entry.error}
              </p>
            ))}
            {filteredRows.length === 0 ? (
              <p className="muted">{t('noSessionsFilter')}</p>
            ) : (
              <SessionsTable
                rows={filteredRows}
                onSelectInstance={selectInstance}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
