import { useMemo, useState } from 'react';
import { useUrlFilters } from '../../hooks/useUrlFilters';
import { useTranslation } from 'react-i18next';
import { useFleet } from '../../hooks/useFleet';
import { useFleetSessionsHistory } from '../../hooks/useFleetSessionsHistory';
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

function timeFilterStart(timeFilter: TimeFilter, now: number): number | undefined {
  if (timeFilter === 'all') return undefined;
  if (timeFilter === 'today') {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay.getTime();
  }
  if (timeFilter === '24h') return now - 86_400_000;
  return now - 7 * 86_400_000;
}

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
  const { values, setFilter, setFilters } = useUrlFilters({
    status: { key: 'status', defaultValue: 'all' as StatusFilter },
    time: { key: 'time', defaultValue: '24h' as TimeFilter },
    q: { key: 'q', defaultValue: '', debounceMs: 250 },
    focus: { key: 'focus', defaultValue: 'all' as DashboardStatusFocus },
    trend: { key: 'trend', defaultValue: '24h' as '24h' | '7d' },
    instance: {
      key: 'instance',
      defaultValue: undefined as string | undefined,
      parse: (value: string | null) => value ?? undefined,
      serialize: (value: string | undefined) => value,
    },
  });
  const statusFilter = values.status;
  const timeFilter = values.time;
  const searchQuery = values.q;
  const statusFocus = values.focus;
  const trendWindow = values.trend;
  const [timeAnchor, setTimeAnchor] = useState(() => Date.now());

  const query = useMemo(() => {
    const from = timeFilterStart(timeFilter, timeAnchor);
    return {
      ...(from != null ? { from } : {}),
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
      ...(values.instance ? { instanceId: values.instance } : {}),
      limit: 1000,
    };
  }, [searchQuery, statusFilter, timeAnchor, timeFilter, values.instance]);
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    dataUpdatedAt,
    historyDisabled,
  } = useFleetSessionsHistory({ query });

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
                  onChange={(event) => setFilter('q', event.target.value)}
                  placeholder={t('activitySearchPlaceholder')}
                  aria-label={t('activitySearchLabel')}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="activity-search-clear"
                    onClick={() => setFilter('q', '')}
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
                    onClick={() => setFilter('status', key)}
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
                    onClick={() => {
                      setTimeAnchor(Date.now());
                      setFilter('time', key);
                    }}
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
              dataUpdatedAt={dataUpdatedAt}
              statusFocus={statusFocus}
              onStatusFocusChange={(focus) => setFilter('focus', focus)}
              onSearchQueryChange={(value) => setFilter('q', value)}
              trendWindow={trendWindow}
              onTrendWindowChange={(value) => setFilter('trend', value)}
            />

            <div className="activity-board-toolbar">
              <div className="activity-board-results">
                <span className="activity-board-results-value">{filteredRows.length}</span>
                <span className="activity-board-results-label">
                  {t('activityResultsSummary', {
                    shown: filteredRows.length,
                    total: data?.totalEstimate ?? allRows.length,
                  })}
                </span>
              </div>
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="secondary-button activity-board-reset"
                  onClick={() => setFilters({
                    status: 'all',
                    time: '24h',
                    focus: 'all',
                    q: '',
                    trend: '24h',
                    instance: undefined,
                  })}
                >
                  {t('activityResetFilters')}
                </button>
              ) : null}
            </div>
          </>
        )}

        {historyDisabled ? (
          <p className="muted">{t('sessionHistoryDisabled')}</p>
        ) : isLoading ? (
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
