import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import type { InstanceSessionRow } from '../../types';
import { ActivityBoard } from './ActivityBoard';
import {
  buildBoardColumns,
  buildFlatRows,
  filterRows,
  formatCost,
  formatRelative,
  formatTokens,
  sessionTimestamp,
  sessionTitle,
  sortRows,
  summarizeRows,
  type ActivityViewMode,
  type FlatRow,
  type SortCol,
  type SortDir,
  type StatusFilter,
  type TimeFilter,
} from './activityViewModel';

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

// ─── filter types ────────────────────────────────────────────────────────────

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
      <td className="col-numeric">{session.estimatedCostUsd != null ? formatCost(session.estimatedCostUsd) : '—'}</td>
      <td className="muted col-preview">{session.lastMessagePreview ? truncate(session.lastMessagePreview, 60) : '—'}</td>
      <td className="muted col-numeric">{formatRelative(sessionTimestamp(session))}</td>
    </tr>
  );
}

// ─── SortHeader component ─────────────────────────────────────────────────────

function SortHeader({ col, label, sortCol, sortDir, onSort }: {
  col: SortCol;
  label: string;
  sortCol: SortCol | null;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th
      className={`sortable-th${active ? ' sortable-th--active' : ''}`}
      aria-sort={ariaSort}
      scope="col"
    >
      <button
        type="button"
        className="sortable-th-button"
        onClick={() => onSort(col)}
      >
        <span>{label}</span>
        <span aria-hidden="true">{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );
}

// ─── SessionsTable component ──────────────────────────────────────────────────

function SessionsTable({ rows, errors, onSelectInstance, sortCol, sortDir, onSort }: {
  rows: FlatRow[];
  errors: { instanceId: string; error: string }[];
  onSelectInstance: (id: string) => void;
  sortCol: SortCol | null;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
}) {
  const { t } = useTranslation();

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
            <SortHeader col="tokens" label={t('colTokens')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <SortHeader col="cost" label={t('colCost')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <th>{t('colLastMessage')}</th>
            <SortHeader col="updated" label={t('colUpdated')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {errors.map((entry) => (
            <tr key={`error:${entry.instanceId}`} className="session-table-row session-table-row--error">
              <td colSpan={9} className="error-text">⚠ {entry.instanceId}: {entry.error}</td>
            </tr>
          ))}
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

  const [viewMode, setViewMode] = useState<ActivityViewMode>('board');
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
  const summary = useMemo(() => summarizeRows(allRows), [allRows]);

  // Filtered + sorted rows
  const filteredRows = useMemo(() => {
    return sortRows(filterRows(allRows, statusFilter, timeFilter), sortCol, sortDir);
  }, [allRows, statusFilter, timeFilter, sortCol, sortDir]);

  // Error rows from instances that failed to fetch
  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((e) => !!e.error),
    [data],
  );
  const boardColumns = useMemo(() => buildBoardColumns(filteredRows), [filteredRows]);

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
              <span className="sessions-stat-value">{summary.totalSessions}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('tokens')}</span>
              <span className="sessions-stat-value">{formatTokens(summary.totalTokens)}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('cost')}</span>
              <span className="sessions-stat-value">{summary.hasCostData ? formatCost(summary.totalCost) : '$—'}</span>
            </span>
          </div>
        )}

        {/* Filter row */}
        {data && (
          <div className="sessions-filter-row">
            <div className="filter-tabs filter-tabs--segmented" role="group" aria-label={t('activityViewMode')}>
              <button
                type="button"
                className={`filter-tab${viewMode === 'board' ? ' filter-tab--active' : ''}`}
                aria-pressed={viewMode === 'board'}
                onClick={() => setViewMode('board')}
              >
                {t('activityViewBoard')}
              </button>
              <button
                type="button"
                className={`filter-tab${viewMode === 'table' ? ' filter-tab--active' : ''}`}
                aria-pressed={viewMode === 'table'}
                onClick={() => setViewMode('table')}
              >
                {t('activityViewTable')}
              </button>
            </div>
            <div className="filter-tabs">
              {STATUS_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  type="button"
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
                  type="button"
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
          <p className="error-text">{error instanceof Error ? error.message : String(error)}</p>
        ) : !data || (allRows.length === 0 && errorEntries.length === 0) ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : (
          <>
            {filteredRows.length === 0 && errorEntries.length === 0 ? (
              <p className="muted">{t('noSessionsFilter')}</p>
            ) : null}
            {(filteredRows.length > 0 || errorEntries.length > 0) && (
              viewMode === 'board' ? (
                <ActivityBoard
                  columns={boardColumns}
                  errors={errorEntries.map((e) => ({ instanceId: e.instanceId, error: e.error ?? '' }))}
                  onSelectInstance={selectInstance}
                />
              ) : (
                <SessionsTable
                  rows={filteredRows}
                  errors={errorEntries.map((e) => ({ instanceId: e.instanceId, error: e.error ?? '' }))}
                  onSelectInstance={selectInstance}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              )
            )}
          </>
        )}
      </section>
    </div>
  );
}
