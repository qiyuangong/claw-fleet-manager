import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getProfilePlugins, installProfilePlugin, restartInstance, uninstallProfilePlugin } from '../../api/fleet';
import type { FleetInstance } from '../../types';
import type { ProfilePlugin } from '../../api/fleet';
import { ConfirmDialog } from '../common/ConfirmDialog';

function pluginLabel(plugin: ProfilePlugin): string {
  return plugin.name?.trim() || plugin.id;
}

export function PluginsTab({ instance }: { instance: FleetInstance }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [spec, setSpec] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<ProfilePlugin | null>(null);

  const pluginsQuery = useQuery({
    queryKey: ['plugins', instance.id],
    queryFn: () => getProfilePlugins(instance.id),
    enabled: Boolean(instance.profile),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['plugins', instance.id] });
    void queryClient.invalidateQueries({ queryKey: ['fleet'] });
  };

  const installMutation = useMutation({
    mutationFn: (pluginSpec: string) => installProfilePlugin(instance.id, pluginSpec),
    onSuccess: (result) => {
      setOutput(result.output || t('pluginInstalled'));
      setError(null);
      setSpec('');
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : t('failedInstallPlugin'));
      setOutput(null);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (pluginId: string) => uninstallProfilePlugin(instance.id, pluginId),
    onSuccess: (result) => {
      setOutput(result.output || t('pluginRemoved'));
      setError(null);
      setPendingRemoval(null);
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : t('failedRemovePlugin'));
      setOutput(null);
      setPendingRemoval(null);
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => restartInstance(instance.id),
    onSuccess: () => {
      setOutput((current) => current ? `${current}\n\n${t('instanceRestarted')}` : t('instanceRestarted'));
      setError(null);
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : t('failedRestartInstance'));
    },
  });

  if (!instance.profile) {
    return (
      <section className="panel-card">
        <p className="muted">{t('profileModeOnly')}</p>
      </section>
    );
  }

  const plugins = pluginsQuery.data?.plugins ?? [];

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>{t('plugins')}</h3>
          <p className="muted">{t('pluginsDesc')}</p>
        </div>
      </div>

      <div className="metric-card" style={{ marginBottom: '1rem' }}>
        <p className="metric-label">{t('installPlugin')}</p>
        <div className="action-row">
          <input
            className="mock-input"
            style={{ flex: 1, minWidth: '18rem' }}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder={t('pluginSpecPlaceholder')}
          />
          <button
            className="primary-button"
            onClick={() => installMutation.mutate(spec.trim())}
            disabled={!spec.trim() || installMutation.isPending}
          >
            {installMutation.isPending ? t('installing') : t('install')}
          </button>
          <button
            className="secondary-button"
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending}
          >
            {restartMutation.isPending ? t('restarting') : t('restartInstance')}
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          {t('restartInstanceHint')}
        </p>
      </div>

      {pluginsQuery.isLoading ? <div className="panel-card muted">{t('loadingPlugins')}</div> : null}
      {pluginsQuery.error ? (
        <div className="panel-card error-text">
          {pluginsQuery.error instanceof Error ? pluginsQuery.error.message : t('failedLoadPlugins')}
        </div>
      ) : null}

      <div className="section-grid">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="metric-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
              <div>
                <p className="metric-value" style={{ marginBottom: '0.25rem' }}>{pluginLabel(plugin)}</p>
                <p className="metric-label mono">{plugin.id}</p>
              </div>
              <button
                className="danger-button"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => setPendingRemoval(plugin)}
                disabled={uninstallMutation.isPending}
              >
                {t('remove')}
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.5rem', minHeight: '2.5rem' }}>
              {plugin.description ?? 'No description'}
            </p>
            <div className="section-grid" style={{ marginTop: '0.5rem' }}>
              <div>
                <p className="metric-label">{t('version')}</p>
                <p className="mono">{plugin.version ?? 'unknown'}</p>
              </div>
              <div>
                <p className="metric-label">{t('status')}</p>
                <p>{plugin.status ?? (plugin.enabled ? 'enabled' : 'unknown')}</p>
              </div>
              <div>
                <p className="metric-label">{t('origin')}</p>
                <p>{plugin.origin ?? 'unknown'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!pluginsQuery.isLoading && plugins.length === 0 ? (
        <div className="panel-card muted" style={{ marginTop: '1rem' }}>
          {t('noPlugins')}
        </div>
      ) : null}

      {output ? (
        <pre className="muted" style={{ marginTop: '1rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {output}
        </pre>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={t('removePlugin')}
        message={
          pendingRemoval
            ? t('removePluginConfirm', { plugin: pluginLabel(pendingRemoval), profile: instance.profile })
            : ''
        }
        confirmLabel={t('remove')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) {
            uninstallMutation.mutate(pendingRemoval.id);
          }
        }}
      />
    </section>
  );
}
