import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfilePlugins, installProfilePlugin, restartInstance, uninstallProfilePlugin } from '../../api/fleet';
import type { FleetInstance } from '../../types';
import type { ProfilePlugin } from '../../api/fleet';
import { ConfirmDialog } from '../common/ConfirmDialog';

function pluginLabel(plugin: ProfilePlugin): string {
  return plugin.name?.trim() || plugin.id;
}

export function PluginsTab({ instance }: { instance: FleetInstance }) {
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
      setOutput(result.output || 'Plugin installed.');
      setError(null);
      setSpec('');
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'Failed to install plugin');
      setOutput(null);
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (pluginId: string) => uninstallProfilePlugin(instance.id, pluginId),
    onSuccess: (result) => {
      setOutput(result.output || 'Plugin removed.');
      setError(null);
      setPendingRemoval(null);
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'Failed to remove plugin');
      setOutput(null);
      setPendingRemoval(null);
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => restartInstance(instance.id),
    onSuccess: () => {
      setOutput((current) => current ? `${current}\n\nInstance restarted.` : 'Instance restarted.');
      setError(null);
      refresh();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'Failed to restart instance');
    },
  });

  if (!instance.profile) {
    return (
      <section className="panel-card">
        <p className="muted">Plugin management is available only for profile-mode instances.</p>
      </section>
    );
  }

  const plugins = pluginsQuery.data?.plugins ?? [];

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>Plugins</h3>
          <p className="muted">Install or remove plugins for this profile. Changes are written into the profile config.</p>
        </div>
      </div>

      <div className="metric-card" style={{ marginBottom: '1rem' }}>
        <p className="metric-label">Install Plugin</p>
        <div className="action-row">
          <input
            className="mock-input"
            style={{ flex: 1, minWidth: '18rem' }}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="@openclaw/feishu or local path"
          />
          <button
            className="primary-button"
            onClick={() => installMutation.mutate(spec.trim())}
            disabled={!spec.trim() || installMutation.isPending}
          >
            {installMutation.isPending ? 'Installing...' : 'Install'}
          </button>
          <button
            className="secondary-button"
            onClick={() => restartMutation.mutate()}
            disabled={restartMutation.isPending}
          >
            {restartMutation.isPending ? 'Restarting...' : 'Restart Instance'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          Restart the instance after install or removal so plugin changes are loaded into the running gateway.
        </p>
      </div>

      {pluginsQuery.isLoading ? <div className="panel-card muted">Loading plugins...</div> : null}
      {pluginsQuery.error ? (
        <div className="panel-card error-text">
          {pluginsQuery.error instanceof Error ? pluginsQuery.error.message : 'Failed to load plugins'}
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
                Remove
              </button>
            </div>
            <p className="muted" style={{ marginTop: '0.5rem', minHeight: '2.5rem' }}>
              {plugin.description ?? 'No description'}
            </p>
            <div className="section-grid" style={{ marginTop: '0.5rem' }}>
              <div>
                <p className="metric-label">Version</p>
                <p className="mono">{plugin.version ?? 'unknown'}</p>
              </div>
              <div>
                <p className="metric-label">Status</p>
                <p>{plugin.status ?? (plugin.enabled ? 'enabled' : 'unknown')}</p>
              </div>
              <div>
                <p className="metric-label">Origin</p>
                <p>{plugin.origin ?? 'unknown'}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!pluginsQuery.isLoading && plugins.length === 0 ? (
        <div className="panel-card muted" style={{ marginTop: '1rem' }}>
          No plugins discovered for this profile yet.
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
        title="Remove Plugin"
        message={
          pendingRemoval
            ? `Remove plugin "${pluginLabel(pendingRemoval)}" from profile "${instance.profile}"?\n\nRestart the instance afterwards to unload it from the running gateway.`
            : ''
        }
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
