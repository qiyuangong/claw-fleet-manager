import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import type { InstanceSessionRow } from '../../types';
import { ActivityBoard } from './ActivityBoard';
import {
  buildBoardColumns,
  buildFlatRows,
  columnLabelKey,
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

function statusLabelKey(status: InstanceSessionRow['status']): string | null {
  if (status === 'running') return 'sessionRunning';
  if (status === 'done') return 'sessionDone';
  if (status === 'failed') return 'sessionFailed';
  if (status === 'killed') return 'sessionKilled';
  if (status === 'timeout') return 'sessionTimeout';
  return null;
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
  const { t } = useTranslation();
  const statusDotClass =
    session.status === 'running' ? 'status-dot--running' :
    session.status === 'done' ? 'status-dot--done' :
    session.status != null ? 'status-dot--error' : 'status-dot--none';
  const statusBadgeClass =
    session.status === 'running' ? 'session-status-badge--running' :
    session.status === 'done' ? 'session-status-badge--done' :
    session.status === 'killed' || session.status === 'timeout' ? 'session-status-badge--warning' :
    session.status != null ? 'session-status-badge--error' : '';
  const statusKey = statusLabelKey(session.status);
  const rowClass =
    session.status === 'running' ? 'session-table-row--running' :
    session.status === 'done' ? 'session-table-row--done' :
    session.status === 'killed' || session.status === 'timeout' ? 'session-table-row--warning' :
    session.status != null ? 'session-table-row--errorStatus' : '';

  return (
    <tr className={`session-table-row ${rowClass}`.trim()}>
      <td className="session-cell session-cell--status"><span className={`status-dot ${statusDotClass}`} /></td>
      <td className="session-cell session-cell--instance">
        <button
          className="link-button session-instance-button"
          onClick={() => onSelectInstance(instanceId)}
        >
          {instanceId}
        </button>
      </td>
      <td className="session-cell session-cell--session">
        <div className="session-title-stack">
          <div className="session-title-main" title={sessionTitle(session)}>
            {truncate(sessionTitle(session), 64)}
          </div>
          <div className="session-title-sub">
            {statusKey ? (
              <span className={`session-status-badge ${statusBadgeClass}`}>
                {t(statusKey as Parameters<typeof t>[0])}
              </span>
            ) : null}
            {session.kind ? <span className="session-meta-pill">{session.kind}</span> : null}
            {session.model ? (
              <span className="session-meta-pill session-meta-pill--model" title={session.model}>
                {truncate(session.model, 24)}
              </span>
            ) : null}
            <span className="session-key" title={session.key}>{session.key}</span>
          </div>
        </div>
      </td>
      <td className="session-cell session-cell--numeric col-numeric">{formatTokens(session.totalTokens)}</td>
      <td className="session-cell session-cell--numeric col-numeric">
        {session.estimatedCostUsd != null ? formatCost(session.estimatedCostUsd) : '—'}
      </td>
      <td className="session-cell session-cell--preview muted">
        <div className="session-preview">
          {session.lastMessagePreview ?? '—'}
        </div>
      </td>
      <td className="session-cell session-cell--updated muted">{formatRelative(sessionTimestamp(session))}</td>
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
            <SortHeader col="tokens" label={t('colTokens')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <SortHeader col="cost" label={t('colCost')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <th className="sessions-table-col-preview">{t('colLastMessage')}</th>
            <SortHeader col="updated" label={t('colUpdated')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {errors.map((entry) => (
            <tr key={`error:${entry.instanceId}`} className="session-table-row session-table-row--error">
              <td colSpan={7} className="error-text">⚠ {entry.instanceId}: {entry.error}</td>
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
  const [densityMode, setDensityMode] = useState<'comfortable' | 'dense'>('comfortable');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
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
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const baseRows = filterRows(allRows, statusFilter, timeFilter);

    const searchedRows = normalizedQuery.length === 0
      ? baseRows
      : baseRows.filter((row) => {
        const haystacks = [
          row.instanceId,
          sessionTitle(row.session),
          row.session.key,
          row.session.kind,
          row.session.model,
          row.session.lastMessagePreview,
        ];

        return haystacks.some((value) => value?.toLowerCase().includes(normalizedQuery));
      });

    return sortRows(searchedRows, sortCol, sortDir);
  }, [allRows, statusFilter, timeFilter, searchQuery, sortCol, sortDir]);

  // Error rows from instances that failed to fetch
  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((e) => !!e.error),
    [data],
  );
  const boardColumns = useMemo(() => buildBoardColumns(filteredRows), [filteredRows]);
  const hasActiveFilters = statusFilter !== 'all' || timeFilter !== 'all' || searchQuery.trim().length > 0;

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
            <div className="filter-tabs filter-tabs--segmented" role="group" aria-label={t('activityDensityMode')}>
              <button
                type="button"
                className={`filter-tab${densityMode === 'comfortable' ? ' filter-tab--active' : ''}`}
                aria-pressed={densityMode === 'comfortable'}
                onClick={() => setDensityMode('comfortable')}
              >
                {t('activityDensityComfortable')}
              </button>
              <button
                type="button"
                className={`filter-tab${densityMode === 'dense' ? ' filter-tab--active' : ''}`}
                aria-pressed={densityMode === 'dense'}
                onClick={() => setDensityMode('dense')}
              >
                {t('activityDensityDense')}
              </button>
            </div>
            <label className="activity-search">
              <span className="sr-only">{t('activitySearchLabel')}</span>
              <input
                type="search"
                className="activity-search-input"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('activitySearchPlaceholder')}
                aria-label={t('activitySearchLabel')}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="activity-search-clear"
                  onClick={() => setSearchQuery('')}
                >
                  {t('clear')}
                </button>
              ) : null}
            </label>
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

        {data && (
          <div className="activity-board-toolbar">
            <div className="activity-board-results">
              <span className="activity-board-results-value">{filteredRows.length}</span>
              <span className="activity-board-results-label">
                {t('activityResultsSummary', { shown: filteredRows.length, total: allRows.length })}
              </span>
            </div>
            <div className="activity-board-chips" aria-label={t('activityBoardColumnsLabel')}>
              {boardColumns.map((column) => (
                <span
                  key={column.key}
                  className={`activity-board-chip activity-board-chip--${column.key}`}
                >
                  {t(columnLabelKey(column.key) as Parameters<typeof t>[0])}
                  <strong>{column.rows.length}</strong>
                </span>
              ))}
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                className="secondary-button activity-board-reset"
                onClick={() => {
                  setStatusFilter('all');
                  setTimeFilter('all');
                  setSearchQuery('');
                }}
              >
                {t('activityResetFilters')}
              </button>
            ) : null}
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
              <div className={`activity-surface activity-surface--${densityMode}`}>
                {viewMode === 'board' ? (
                <ActivityBoard
                  columns={boardColumns}
                  errors={errorEntries.map((e) => ({ instanceId: e.instanceId, error: e.error ?? '' }))}
                  onSelectInstance={(id) => selectInstance(id, 'activity')}
                />
              ) : (
                <SessionsTable
                  rows={filteredRows}
                  errors={errorEntries.map((e) => ({ instanceId: e.instanceId, error: e.error ?? '' }))}
                  onSelectInstance={(id) => selectInstance(id, 'activity')}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
