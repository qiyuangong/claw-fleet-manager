import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import { StatusBadge } from '../common/StatusBadge';
import type { InstanceSessionRow } from '../../types';

const STATUS_LABEL_KEYS: Record<NonNullable<InstanceSessionRow['status']>, string> = {
  running: 'sessionRunning',
  done: 'sessionDone',
  failed: 'sessionFailed',
  killed: 'sessionKilled',
  timeout: 'sessionTimeout',
} as const;

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
    ? t(STATUS_LABEL_KEYS[session.status] as Parameters<typeof t>[0])
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
  const { data, isLoading, error, refetch, isFetching } = useFleetSessions();
  const selectInstance = useAppStore((state) => state.selectInstance);

  const totalRunningSessions = data?.instances.reduce(
    (sum, entry) => sum + entry.sessions.filter((s) => s.status === 'running').length,
    0,
  ) ?? 0;
  const instanceCount = data?.instances.filter((e) => e.sessions.length > 0 || !!e.error).length ?? 0;

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('activeSessions')}</h2>
            {data ? (
              <p className="muted">
                {instanceCount} instances · {totalRunningSessions} running
              </p>
            ) : null}
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : t('refresh')}
          </button>
        </div>

        {isLoading ? (
          <p className="muted">{t('loadingSessions')}</p>
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

              {entry.sessions.map((session) => (
                <SessionRow key={session.key} session={session} />
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
