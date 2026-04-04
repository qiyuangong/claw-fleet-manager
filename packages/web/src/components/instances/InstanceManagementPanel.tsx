import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteInstance } from '../../api/fleet';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AddInstanceDialog } from './AddInstanceDialog';

interface Props {
  onOpenInstance: (id: string) => void;
}

export function InstanceManagementPanel({ onOpenInstance }: Props) {
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const { data: fleet, isLoading } = useFleet();
  const queryClient = useQueryClient();
  const [createKind, setCreateKind] = useState<'docker' | 'profile' | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInstance(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setPendingDelete(null);
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

      {fleet.instances.length === 0 ? (
        <div className="profile-empty-state">
          <p style={{ margin: 0 }}>{t('noInstancesAvailable')}</p>
          <p className="muted" style={{ margin: 0 }}>{t('noInstancesManagementHelp')}</p>
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
                <th>{t('pid')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {fleet.instances.map((instance) => (
                <tr key={instance.id}>
                  <td className="mono">{instance.id}</td>
                  <td>{instance.mode === 'docker' ? t('dockerInstanceType') : t('profileInstanceType')}</td>
                  <td>{instance.status}</td>
                  <td>{instance.health}</td>
                  <td className="mono">:{instance.port}</td>
                  <td className="mono">{instance.pid ?? '-'}</td>
                  <td>
                    <div className="action-row">
                      <button className="secondary-button" onClick={() => onOpenInstance(instance.id)}>
                        {t('openInstance')}
                      </button>
                      <button
                        className="danger-button"
                        onClick={() => setPendingDelete(instance.id)}
                        disabled={deleteMutation.isPending}
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
