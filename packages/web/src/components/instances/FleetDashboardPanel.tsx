import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFleet } from '../../hooks/useFleet';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import { Dashboard, type DashboardStatusFocus } from './Dashboard';
import {
  buildFlatRows,
  filterRows,
  sessionTitle,
  type StatusFilter,
  type TimeFilter,
} from './activityViewModel';

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

type FlatRowSessionStatus = ReturnType<typeof buildFlatRows>[number]['session']['status'];

function dashboardStatusBucket(status: FlatRowSessionStatus): DashboardStatusFocus {
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'killed' || status === 'timeout') return 'killedTimeout';
  return 'other';
}

export function FleetDashboardPanel() {
  const { t } = useTranslation();
  const { data: fleet } = useFleet();
  const { data, isLoading, error, refetch, isFetching } = useFleetSessions();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('24h');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFocus, setStatusFocus] = useState<DashboardStatusFocus>('all');

  const allRows = useMemo(() => buildFlatRows(data?.instances ?? []), [data]);
  const dashboardRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const baseRows = filterRows(allRows, statusFilter, 'all');
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

    return statusFocus === 'all'
      ? searchedRows
      : searchedRows.filter((row) => dashboardStatusBucket(row.session.status) === statusFocus);
  }, [allRows, searchQuery, statusFilter, statusFocus]);
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

    return statusFocus === 'all'
      ? searchedRows
      : searchedRows.filter((row) => dashboardStatusBucket(row.session.status) === statusFocus);
  }, [allRows, searchQuery, statusFilter, timeFilter, statusFocus]);

  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((entry) => !!entry.error),
    [data],
  );
  const hasActiveFilters =
    statusFilter !== 'all' ||
    timeFilter !== '24h' ||
    statusFocus !== 'all' ||
    searchQuery.trim().length > 0;

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('dashboard')}</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>{t('dashboardDesc')}</p>
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : t('refresh')}
          </button>
        </div>

        {data && (
          <>
            <div className="sessions-filter-row">
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

            <Dashboard
              rows={filteredRows}
              throughputRows={dashboardRows}
              instances={fleet?.instances ?? []}
              statusFocus={statusFocus}
              onStatusFocusChange={setStatusFocus}
              onSearchQueryChange={setSearchQuery}
            />

            <div className="activity-board-toolbar">
              <div className="activity-board-results">
                <span className="activity-board-results-value">{filteredRows.length}</span>
                <span className="activity-board-results-label">
                  {t('activityResultsSummary', { shown: filteredRows.length, total: allRows.length })}
                </span>
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="secondary-button activity-board-reset"
                  onClick={() => {
                    setStatusFilter('all');
                    setTimeFilter('24h');
                    setStatusFocus('all');
                    setSearchQuery('');
                  }}
                >
                  {t('activityResetFilters')}
                </button>
              ) : null}
            </div>
          </>
        )}

        {isLoading ? (
          <p className="muted">{t('loadingSessions')}</p>
        ) : error ? (
          <p className="error-text">{error instanceof Error ? error.message : String(error)}</p>
        ) : !data || (filteredRows.length === 0 && errorEntries.length === 0) ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : errorEntries.length > 0 ? (
          <div className="field-grid" style={{ marginTop: '1rem' }}>
            {errorEntries.map((entry) => (
              <p key={entry.instanceId} className="error-text" style={{ margin: 0 }}>
                {entry.instanceId}: {entry.error}
              </p>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
