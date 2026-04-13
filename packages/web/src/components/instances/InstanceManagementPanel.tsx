import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteInstance, startInstance, stopInstance } from '../../api/fleet';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import type { FleetInstance } from '../../types';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AddInstanceDialog } from './AddInstanceDialog';
import { RenameInstanceDialog } from './RenameInstanceDialog';

interface Props {
  onOpenInstance: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function UsageCell({ instance, t }: { instance: FleetInstance; t: ReturnType<typeof useTranslation>['t'] }) {
  const cpuPercent = Math.max(0, Math.min(instance.cpu, 100));
  const memPercent = instance.memory.limit > 0
    ? Math.max(0, Math.min((instance.memory.used / instance.memory.limit) * 100, 100))
    : 0;
  const memoryLimitLabel = instance.memory.limit > 0 ? formatBytes(instance.memory.limit) : t('noLimit');

  return (
    <div className="instance-usage-cell">
      <div className="instance-usage-row">
        <div className="instance-usage-meta">
          <span className="instance-usage-label">{t('cpu')}</span>
          <span className="instance-usage-value">{instance.cpu.toFixed(1)}%</span>
        </div>
        <div className="instance-usage-track">
          <span className="instance-usage-fill instance-usage-fill--cpu" style={{ width: `${cpuPercent}%` }} />
        </div>
      </div>
      <div className="instance-usage-row">
        <div className="instance-usage-meta">
          <span className="instance-usage-label">{t('memory')}</span>
          <span className="instance-usage-value">{formatBytes(instance.memory.used)} / {memoryLimitLabel}</span>
        </div>
        <div className="instance-usage-track">
          <span className="instance-usage-fill instance-usage-fill--memory" style={{ width: `${memPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

export function InstanceManagementPanel({ onOpenInstance }: Props) {
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const { data: fleet, isLoading } = useFleet();
  const queryClient = useQueryClient();
  const [createKind, setCreateKind] = useState<'docker' | 'profile' | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingRename, setPendingRename] = useState<FleetInstance | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInstance(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setPendingDelete(null);
    },
  });
  const startMutation = useMutation({
    mutationFn: (id: string) => startInstance(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    },
  });
  const stopMutation = useMutation({
    mutationFn: (id: string) => stopInstance(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    },
  });

  if (currentUser?.role !== 'admin') {
    return (
      <section className="panel-card">
        <p className="error-text">{t('adminAccessRequired')}</p>
      </section>
    );
  }

  if (isLoading || !fleet) {
    return <div className="panel-card muted">{t('loadingFleet')}</div>;
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredInstances = normalizedQuery.length === 0
    ? fleet.instances
    : fleet.instances.filter((instance) => {
      const haystacks = [
        instance.id,
        instance.mode === 'docker' ? t('dockerInstanceType') : t('profileInstanceType'),
        instance.status,
        instance.health,
      ];

      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    });

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">{t('admin')}</p>
          <h2 className="panel-title">{t('instanceManagement')}</h2>
          <p className="muted">{t('instanceManagementDesc')}</p>
        </div>
      </div>

      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>{t('createInstancePanelTitle')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{t('createInstancePanelHelp')}</p>
        <div className="action-row">
          <div style={{ position: 'relative' }}>
            <button className="primary-button" onClick={() => setShowCreateMenu((current) => !current)}>
              {t('addInstance')}
            </button>
            {showCreateMenu ? (
              <div className="panel-card" style={{ position: 'absolute', top: 'calc(100% + 0.5rem)', left: 0, zIndex: 10, minWidth: '15rem' }}>
                <button
                  className="secondary-button"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => {
                    setShowCreateMenu(false);
                    setCreateKind('docker');
                  }}
                >
                  {t('createDockerInstance')}
                </button>
                <button
                  className="secondary-button"
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => {
                    setShowCreateMenu(false);
                    setCreateKind('profile');
                  }}
                >
                  {t('createProfileInstance')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sessions-filter-row" style={{ marginBottom: '1rem' }}>
        <label className="activity-search">
          <span className="sr-only">{t('instanceManagementSearchLabel')}</span>
          <input
            type="search"
            className="activity-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('instanceManagementSearchPlaceholder')}
            aria-label={t('instanceManagementSearchLabel')}
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
      </div>

      {filteredInstances.length === 0 ? (
        <div className="profile-empty-state">
          <p style={{ margin: 0 }}>{searchQuery ? t('noInstancesMatch') : t('noInstancesAvailable')}</p>
          <p className="muted" style={{ margin: 0 }}>
            {searchQuery ? t('instanceManagementSearchEmpty') : t('noInstancesManagementHelp')}
          </p>
        </div>
      ) : (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('instance')}</th>
                <th>{t('type')}</th>
                <th>{t('status')}</th>
                <th>{t('health')}</th>
                <th>{t('port')}</th>
                <th>{t('usage')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredInstances.map((instance) => (
                <tr key={instance.id}>
                  <td className="mono">{instance.id}</td>
                  <td>{instance.mode === 'docker' ? t('dockerInstanceType') : t('profileInstanceType')}</td>
                  <td>{instance.status}</td>
                  <td>{instance.health}</td>
                  <td className="mono">:{instance.port}</td>
                  <td><UsageCell instance={instance} t={t} /></td>
                  <td>
                    <div className="action-row instance-management-actions">
                      <button className="secondary-button" onClick={() => onOpenInstance(instance.id)}>
                        {t('openInstance')}
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => startMutation.mutate(instance.id)}
                        disabled={instance.status === 'running' || startMutation.isPending || stopMutation.isPending}
                      >
                        {t('start')}
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => stopMutation.mutate(instance.id)}
                        disabled={instance.status === 'stopped' || stopMutation.isPending || startMutation.isPending}
                      >
                        {t('stop')}
                      </button>
                      <button
                        className="secondary-button"
                        title={instance.status === 'stopped' ? '' : t('renameInstanceRequiresStopped')}
                        onClick={() => setPendingRename(instance)}
                        disabled={
                          instance.status !== 'stopped' ||
                          startMutation.isPending ||
                          stopMutation.isPending
                        }
                      >
                        {t('renameInstance')}
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => setPendingDelete(instance.id)}
                        disabled={deleteMutation.isPending || startMutation.isPending || stopMutation.isPending}
                      >
                        {t('delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingRename ? (
        <RenameInstanceDialog
          instance={pendingRename}
          onClose={() => setPendingRename(null)}
        />
      ) : null}

      {createKind ? <AddInstanceDialog kind={createKind} onClose={() => setCreateKind(null)} /> : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t('deleteInstanceTitle')}
        message={t('deleteInstanceConfirm', { instance: pendingDelete ?? '' })}
        confirmLabel={deleteMutation.isPending ? t('deleting') : t('delete')}
        onCancel={() => {
          if (!deleteMutation.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
        }}
      />
      {deleteMutation.error ? (
        <p className="error-text" style={{ marginBottom: 0 }}>
          {deleteMutation.error instanceof Error ? deleteMutation.error.message : t('deleteInstanceFailed')}
        </p>
      ) : null}
    </section>
  );
}
