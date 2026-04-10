import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import { StatusBadge } from '../common/StatusBadge';
import type { InstanceSessionRow } from '../../types';

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

function formatRuntime(session: InstanceSessionRow): string {
  const ms =
    session.runtimeMs ??
    (session.startedAt != null ? Date.now() - session.startedAt : null);
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function sessionStatusClass(status: InstanceSessionRow['status']): string {
  if (status === 'running') return 'status-badge--running';
  if (status === 'done') return 'status-badge--healthy';
  if (status === 'failed' || status === 'killed' || status === 'timeout') return 'status-badge--unhealthy';
  return '';
}

function SessionRow({ session }: { session: InstanceSessionRow }) {
  const { t } = useTranslation();
  const statusLabel = session.status
    ? t(`session${session.status.charAt(0).toUpperCase()}${session.status.slice(1)}` as Parameters<typeof t>[0])
    : '—';

  return (
    <div className="session-row">
      <div className="session-row-header">
        <span className="session-title">{sessionTitle(session)}</span>
        <span className={`pill ${sessionStatusClass(session.status)}`}>{statusLabel}</span>
        {session.model ? <span className="session-model muted">{session.model}</span> : null}
        <span className="session-runtime muted">{formatRuntime(session)}</span>
      </div>
      {session.lastMessagePreview ? (
        <p className="session-preview muted">{truncate(session.lastMessagePreview, 80)}</p>
      ) : null}
    </div>
  );
}

export function FleetSessionsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useFleetSessions();
  const selectInstance = useAppStore((state) => state.selectInstance);

  const totalRunningSessions = data?.instances.reduce(
    (sum, entry) => sum + entry.sessions.filter((s) => s.status === 'running').length,
    0,
  ) ?? 0;
  const instanceCount = data?.instances.filter((e) => e.sessions.length > 0 || !!e.error).length ?? 0;

  const updatedAgo = dataUpdatedAt
    ? Math.floor((Date.now() - dataUpdatedAt) / 1000)
    : null;

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('activeSessions')}</h2>
            {data ? (
              <p className="muted">
                {instanceCount} instances · {totalRunningSessions} running
                {updatedAgo != null ? ` · updated ${updatedAgo}s ago` : null}
              </p>
            ) : null}
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : 'Refresh'}
          </button>
        </div>

        {isLoading ? (
          <p className="muted">Loading sessions…</p>
        ) : error ? (
          <p className="error-text">{(error as Error).message}</p>
        ) : !data || data.instances.every((e) => e.sessions.length === 0 && !e.error) ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : (
          data.instances.filter((e) => e.sessions.length > 0 || !!e.error).map((entry) => (
            <div key={entry.instanceId} className="panel-card" style={{ marginBottom: '0.75rem' }}>
              <div className="panel-header" style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <StatusBadge status={entry.sessions.some((s) => s.status === 'running') ? 'running' : 'stopped'} />
                  <button
                    className="sidebar-nav-item"
                    style={{ fontWeight: 600, padding: 0 }}
                    onClick={() => selectInstance(entry.instanceId)}
                  >
                    {entry.instanceId}
                  </button>
                </div>
                {entry.error ? (
                  <span className="error-text" style={{ fontSize: '0.8rem' }}>{t('sessionFetchError')}: {entry.error}</span>
                ) : null}
              </div>

              {entry.error && entry.sessions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>⚠ {t('sessionFetchError')}</p>
              ) : (
                entry.sessions.map((session) => (
                  <SessionRow key={session.key} session={session} />
                ))
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
