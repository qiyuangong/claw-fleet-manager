import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import {
  buildBoardColumns,
  filterRows,
  formatCost,
  formatRelative,
  formatTokens,
  sessionTimestamp,
  sessionTitle,
  sortRows,
  summarizeRows,
  type FlatRow,
  type SortCol,
  type SortDir,
  type StatusFilter,
  type TimeFilter,
} from './activityViewModel';
import { ActivityBoard } from './ActivityBoard';

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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

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

function InstanceSessionsTable({ rows, sortCol, sortDir, onSort }: {
  rows: FlatRow[];
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
            <th>{t('colSession')}</th>
            <th>{t('colType')}</th>
            <th>{t('colModel')}</th>
            <SortHeader col="tokens" label={t('colTokens')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <SortHeader col="cost" label={t('colCost')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
            <th className="sessions-table-col-preview">{t('colLastMessage')}</th>
            <SortHeader col="updated" label={t('colUpdated')} sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.instanceId}:${row.session.key}`} className="session-table-row">
              <td className="session-cell session-cell--session">
                <div className="session-title-stack">
                  <div className="session-title-main" title={sessionTitle(row.session)}>
                    {truncate(sessionTitle(row.session), 72)}
                  </div>
                  <div className="session-title-sub">
                    {row.session.kind ? <span className="session-meta-pill">{row.session.kind}</span> : null}
                    {row.session.model ? (
                      <span className="session-meta-pill session-meta-pill--model" title={row.session.model}>
                        {truncate(row.session.model, 24)}
                      </span>
                    ) : null}
                    <span className="session-key" title={row.session.key}>{row.session.key}</span>
                  </div>
                </div>
              </td>
              <td className="session-cell">{row.session.kind ?? '—'}</td>
              <td className="session-cell muted" title={row.session.model ?? undefined}>
                {row.session.model ? truncate(row.session.model, 28) : '—'}
              </td>
              <td className="session-cell col-numeric">{formatTokens(row.session.totalTokens)}</td>
              <td className="session-cell col-numeric">{formatCost(row.session.estimatedCostUsd)}</td>
              <td className="session-cell session-cell--preview muted">
                <div className="session-preview">{row.session.lastMessagePreview ?? '—'}</div>
              </td>
              <td className="session-cell session-cell--updated muted">{formatRelative(sessionTimestamp(row.session))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InstanceActivityTab({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const { data, isLoading, error, refetch, isFetching } = useFleetSessions();

  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
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

  const instanceEntry = useMemo(
    () => data?.instances.find((entry) => entry.instanceId === instanceId),
    [data, instanceId],
  );
  const allRows = useMemo<FlatRow[]>(
    () => (instanceEntry?.sessions ?? []).map((session) => ({ instanceId, session })),
    [instanceEntry, instanceId],
  );
  const filteredRows = useMemo(
    () => sortRows(filterRows(allRows, statusFilter, timeFilter), sortCol, sortDir),
    [allRows, statusFilter, timeFilter, sortCol, sortDir],
  );
  const summary = useMemo(() => summarizeRows(allRows), [allRows]);
  const columns = useMemo(() => buildBoardColumns(filteredRows), [filteredRows]);

  if (!isAdmin) {
    return <p className="muted">{t('activityAdminOnly')}</p>;
  }

  if (isLoading) {
    return <p className="muted">{t('loadingSessions')}</p>;
  }

  if (error) {
    return <p className="error-text">{error instanceof Error ? error.message : String(error)}</p>;
  }

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h3 style={{ margin: 0 }}>{t('instanceActivity')}</h3>
            <p className="muted">{t('instanceActivityDesc')}</p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : t('refresh')}
          </button>
        </div>

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

        {instanceEntry?.error ? <p className="error-text">{instanceEntry.error}</p> : null}
        {!instanceEntry ? (
          <p className="muted">{t('instanceActivityEmpty')}</p>
        ) : instanceEntry.error ? null : allRows.length === 0 ? (
          <p className="muted">{t('instanceActivityEmpty')}</p>
        ) : filteredRows.length === 0 ? (
          <p className="muted">{t('noSessionsFilter')}</p>
        ) : viewMode === 'board' ? (
          <ActivityBoard columns={columns} errors={[]} onSelectInstance={() => {}} />
        ) : (
          <InstanceSessionsTable rows={filteredRows} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
        )}
      </section>
    </div>
  );
}
