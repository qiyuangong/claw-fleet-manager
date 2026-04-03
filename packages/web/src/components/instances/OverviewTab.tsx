import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { restartInstance, revealToken, startInstance, stopInstance } from '../../api/fleet';
import type { FleetInstance } from '../../types';
import { MaskedValue } from '../common/MaskedValue';
import { StatusBadge } from '../common/StatusBadge';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function OverviewTab({ instance }: { instance: FleetInstance }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['fleet'] });
  };

  const start = useMutation({
    mutationFn: () => startInstance(instance.id),
    onSuccess: () => { invalidate(); toast.success(`${instance.id} started`); },
    onError: (err: Error) => toast.error(`Failed to start ${instance.id}: ${err.message}`),
  });
  const stop = useMutation({
    mutationFn: () => stopInstance(instance.id),
    onSuccess: () => { invalidate(); toast.success(`${instance.id} stopped`); },
    onError: (err: Error) => toast.error(`Failed to stop ${instance.id}: ${err.message}`),
  });
  const restart = useMutation({
    mutationFn: () => restartInstance(instance.id),
    onSuccess: () => { invalidate(); toast.success(`${instance.id} restarted`); },
    onError: (err: Error) => toast.error(`Failed to restart ${instance.id}: ${err.message}`),
  });

  const cpuPercent = Math.max(0, Math.min(instance.cpu, 100));
  const memPercent = instance.memory.limit > 0
    ? Math.max(0, Math.min((instance.memory.used / instance.memory.limit) * 100, 100))
    : 0;
  const memoryLimitLabel = instance.memory.limit > 0 ? formatBytes(instance.memory.limit) : t('noLimit');

  return (
    <div className="field-grid">
      <section className="panel-card">
        <div className="panel-header">
          <div>
            <h3 style={{ margin: 0 }}>{t('runtime')}</h3>
            <p className="muted">{t('runtimeDesc')}</p>
          </div>
          <div className="pill">
            <StatusBadge status={instance.status} />
            <span>{instance.status}</span>
          </div>
        </div>

        <div className="action-row" style={{ marginBottom: '1rem' }}>
          <button className="primary-button" onClick={() => start.mutate()} disabled={instance.status === 'running' || start.isPending}>
            {t('start')}
          </button>
          <button className="danger-button" onClick={() => stop.mutate()} disabled={instance.status === 'stopped' || stop.isPending}>
            {t('stop')}
          </button>
          <button className="secondary-button" onClick={() => restart.mutate()} disabled={instance.status === 'stopped' || restart.isPending}>
            {t('restart')}
          </button>
        </div>

        <div className="section-grid">
          <div className="metric-card">
            <p className="metric-label">{t('port')}</p>
            <p className="metric-value mono">:{instance.port}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{t('uptime')}</p>
            <p className="metric-value">{formatUptime(instance.uptime)}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{t('type')}</p>
            <p className="metric-value">{instance.mode === 'docker' ? t('dockerInstanceType') : t('profileInstanceType')}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{instance.profile ? t('profile') : t('image')}</p>
            <p className="metric-value mono">{instance.profile ?? instance.image}</p>
          </div>
          {instance.pid !== undefined ? (
            <div className="metric-card">
              <p className="metric-label">{t('pid')}</p>
              <p className="metric-value mono">{instance.pid}</p>
            </div>
          ) : (
            <div className="metric-card">
              <p className="metric-label">{t('health')}</p>
              <p className="metric-value">{instance.health}</p>
            </div>
          )}
        </div>
      </section>

      <section className="section-grid">
        <div className="metric-card">
          <p className="metric-label">{t('cpu')}</p>
          <p className="metric-value">{instance.cpu.toFixed(1)}%</p>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${cpuPercent}%` }} />
          </div>
        </div>
        <div className="metric-card">
          <p className="metric-label">{t('memory')}</p>
          <p className="metric-value">{formatBytes(instance.memory.used)} / {memoryLimitLabel}</p>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${memPercent}%` }} />
          </div>
        </div>
      </section>

      <section className="panel-card">
        <p className="metric-label">{t('gatewayToken')}</p>
        <MaskedValue
          masked={instance.token}
          onReveal={async () => (await revealToken(instance.id)).token}
        />
      </section>
    </div>
  );
}
