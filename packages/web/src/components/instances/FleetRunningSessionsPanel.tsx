import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import { useAppStore } from '../../store';
import type { InstanceSessionPreviewItem, InstanceSessionRow } from '../../types';
import {
  buildFlatRows,
  filterRows,
  formatCost,
  formatRelative,
  formatTokens,
  sessionTimestamp,
  sessionTitle,
  sortRows,
  summarizeRows,
} from './activityViewModel';

const PAGE_SIZE = 9;
const LIVE_REFRESH_MS = 300;
const MONITORING_STATE_KEY = 'fleet_running_sessions_monitoring_state';
const PREVIEW_LIMIT = 4;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function loadMonitoringState(): 'stopped' | 'started' {
  if (typeof window === 'undefined') return 'stopped';
  const persisted = window.localStorage.getItem(MONITORING_STATE_KEY);
  return persisted === 'started' ? 'started' : 'stopped';
}

function previewRoleLabel(t: (key: string) => string, role: string): string {
  if (role === 'user') return t('runningSessionsRoleUser');
  if (role === 'assistant') return t('runningSessionsRoleAssistant');
  if (role === 'tool') return t('runningSessionsRoleTool');
  return truncate(role, 12);
}

function previewItemsForSession(session: InstanceSessionRow): InstanceSessionPreviewItem[] {
  return (session.previewItems ?? []).filter((item) => item.text.trim());
}

export function FleetRunningSessionsPanel() {
  const { t } = useTranslation();
  const [monitoringState, setMonitoringState] = useState<'stopped' | 'started'>(loadMonitoringState);
  const monitoringEnabled = monitoringState === 'started';
  const { data, isLoading, error } = useFleetSessions({
    enabled: monitoringEnabled,
    refetchIntervalMs: LIVE_REFRESH_MS,
    status: 'running',
    previewLimit: PREVIEW_LIMIT,
  });
  const selectInstance = useAppStore((state) => state.selectInstance);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [prevTotalPages, setPrevTotalPages] = useState(1);

  const allRunningRows = useMemo(
    () => filterRows(buildFlatRows(data?.instances ?? []), 'active', 'all'),
    [data],
  );
  const summary = useMemo(() => summarizeRows(allRunningRows), [allRunningRows]);
  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const rows = !normalizedQuery ? allRunningRows : allRunningRows.filter((row) => {
      const haystacks = [
        row.instanceId,
        sessionTitle(row.session),
        row.session.key,
        row.session.kind,
        row.session.model,
        row.session.lastMessagePreview,
        ...previewItemsForSession(row.session).map((item) => item.text),
      ];

      return haystacks.some((value) => value?.toLowerCase().includes(normalizedQuery));
    });

    return sortRows(rows, null, 'desc');
  }, [allRunningRows, searchQuery]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  if (totalPages !== prevTotalPages) {
    setPrevTotalPages(totalPages);
    setCurrentPage((page) => Math.min(page, totalPages));
  }
  const pagedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredRows]);
  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((entry) => !!entry.error),
    [data],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MONITORING_STATE_KEY, monitoringState);
  }, [monitoringState]);

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('runningSessionsTitle')}</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>{t('runningSessionsDesc')}</p>
          </div>
          <div className="action-row">
            <span className={`running-sessions-live-pill running-sessions-live-pill--${monitoringState}`}>
              {monitoringEnabled ? t('runningSessionsMonitorStarted') : t('runningSessionsMonitorStopped')}
            </span>
            <button
              className="primary-button"
              onClick={() => setMonitoringState('started')}
              disabled={monitoringEnabled}
            >
              {t('start')}
            </button>
            <button
              className="danger-button"
              onClick={() => setMonitoringState('stopped')}
              disabled={!monitoringEnabled}
            >
              {t('stop')}
            </button>
          </div>
        </div>

        {monitoringEnabled && data ? (
          <>
            <div className="sessions-stats-bar">
              <span className="sessions-stat">
                <span className="sessions-stat-label">{t('runningSessionsCount')}</span>
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
              <label className="activity-search">
                <span className="sr-only">{t('activitySearchLabel')}</span>
                <input
                  type="search"
                  className="activity-search-input"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder={t('activitySearchPlaceholder')}
                  aria-label={t('activitySearchLabel')}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="activity-search-clear"
                    onClick={() => {
                      setSearchQuery('');
                      setCurrentPage(1);
                    }}
                  >
                    {t('clear')}
                  </button>
                ) : null}
              </label>

              <div className="activity-board-results">
                <span className="activity-board-results-value">{filteredRows.length}</span>
                <span className="activity-board-results-label">
                  {t('runningSessionsPageSummary', { shown: filteredRows.length, total: allRunningRows.length })}
                </span>
              </div>
            </div>
          </>
        ) : null}

        {!monitoringEnabled ? (
          <p className="muted">{t('runningSessionsStoppedHelp')}</p>
        ) : isLoading ? (
          <p className="muted">{t('loadingSessions')}</p>
        ) : error ? (
          <p className="error-text">{error instanceof Error ? error.message : String(error)}</p>
        ) : !data || (allRunningRows.length === 0 && errorEntries.length === 0) ? (
          <p className="muted">{t('runningSessionsEmpty')}</p>
        ) : (
          <>
            {errorEntries.length > 0 ? (
              <div className="activity-board-errors">
                {errorEntries.map((entry) => (
                  <div key={entry.instanceId} className="activity-board-error">
                    {entry.instanceId}: {entry.error}
                  </div>
                ))}
              </div>
            ) : null}

            {filteredRows.length === 0 ? (
              <p className="muted">{searchQuery.trim() ? t('runningSessionsNoSearchResults') : t('runningSessionsEmpty')}</p>
            ) : (
              <>
                <div className="running-sessions-grid">
                  {pagedRows.map((row) => {
                    const title = sessionTitle(row.session);
                    const accessibleName = `${row.instanceId} ${title} ${row.session.key}`;

                    return (
                      <button
                        key={`${row.instanceId}:${row.session.key}`}
                        type="button"
                        className="running-session-card"
                        aria-label={accessibleName}
                        onClick={() => selectInstance(row.instanceId, 'activity')}
                      >
                        <div className="running-session-card-top">
                          <span className="running-session-card-instance">{row.instanceId}</span>
                          <span className="session-status-badge session-status-badge--running">
                            {t('sessionRunning')}
                          </span>
                        </div>
                        <div className="running-session-card-title">{title}</div>
                        {previewItemsForSession(row.session).length > 0 ? (
                          <div className="running-session-card-transcript">
                            {previewItemsForSession(row.session).map((item, index) => (
                              <div
                                key={`${item.role}:${index}:${item.text.slice(0, 24)}`}
                                className={`running-session-card-transcript-item running-session-card-transcript-item--${item.role}`}
                              >
                                <span className="running-session-card-transcript-role">
                                  {previewRoleLabel(t, item.role)}
                                </span>
                                <span
                                  className="running-session-card-transcript-text"
                                  title={item.text}
                                >
                                  {truncate(item.text, 220)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="running-session-card-preview">
                            {row.session.lastMessagePreview ?? '—'}
                          </div>
                        )}
                        <div className="running-session-card-pills">
                          {row.session.kind ? <span className="session-meta-pill">{row.session.kind}</span> : null}
                          {row.session.model ? (
                            <span className="session-meta-pill session-meta-pill--model" title={row.session.model}>
                              {row.session.model}
                            </span>
                          ) : null}
                        </div>
                        <dl className="running-session-card-metrics">
                          <div>
                            <dt>{t('tokens')}</dt>
                            <dd>{formatTokens(row.session.totalTokens)}</dd>
                          </div>
                          <div>
                            <dt>{t('cost')}</dt>
                            <dd>{row.session.estimatedCostUsd != null ? formatCost(row.session.estimatedCostUsd) : '$—'}</dd>
                          </div>
                          <div>
                            <dt>{t('colUpdated')}</dt>
                            <dd>{formatRelative(sessionTimestamp(row.session))}</dd>
                          </div>
                        </dl>
                        <div className="running-session-card-footer">
                          <span className="session-key" title={row.session.key}>{row.session.key}</span>
                          <span className="running-session-card-link">{t('runningSessionOpen')}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {totalPages > 1 ? (
                  <nav className="running-sessions-pagination" aria-label={t('runningSessionsPagerLabel')}>
                    <button
                      type="button"
                      className="secondary-button running-sessions-pagination-button"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                    >
                      {t('runningSessionsPrevious')}
                    </button>
                    <div className="running-sessions-pagination-pages">
                      {Array.from({ length: totalPages }, (_, index) => {
                        const page = index + 1;
                        return (
                          <button
                            key={page}
                            type="button"
                            className={`running-sessions-page-number${currentPage === page ? ' running-sessions-page-number--active' : ''}`}
                            onClick={() => setCurrentPage(page)}
                            aria-current={currentPage === page ? 'page' : undefined}
                            aria-label={t('runningSessionsPage', { page })}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="secondary-button running-sessions-pagination-button"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                    >
                      {t('runningSessionsNext')}
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
