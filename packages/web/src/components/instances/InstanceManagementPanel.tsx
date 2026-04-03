import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteProfile } from '../../api/fleet';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AddProfileDialog } from './AddProfileDialog';

interface Props {
  onOpenInstance: (id: string) => void;
}

export function InstanceManagementPanel({ onOpenInstance }: Props) {
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const { data: fleet, isLoading } = useFleet();
  const queryClient = useQueryClient();
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const isProfileMode = fleet?.mode === 'profiles';

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteProfile(name),
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
          <p className="muted">{t(isProfileMode ? 'profileManagementDesc' : 'instanceManagementDesc')}</p>
        </div>
      </div>

      {isProfileMode ? (
        <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ marginTop: 0 }}>{t('createProfilePanelTitle')}</h3>
          <p className="muted" style={{ marginTop: 0 }}>{t('createProfilePanelHelp')}</p>
          <div className="action-row">
            <button className="primary-button" onClick={() => setShowAddProfile(true)}>
              {t('createProfile')}
            </button>
          </div>
        </div>
      ) : null}

      {fleet.instances.length === 0 ? (
        <div className="profile-empty-state">
          <p style={{ margin: 0 }}>{t(isProfileMode ? 'noProfilesAvailable' : 'noInstancesAvailable')}</p>
          <p className="muted" style={{ margin: 0 }}>
            {t(isProfileMode ? 'noProfilesManagementHelp' : 'noInstancesManagementHelp')}
          </p>
        </div>
      ) : (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>{isProfileMode ? t('profile') : t('instance')}</th>
                <th>{t('status')}</th>
                <th>{t('health')}</th>
                <th>{t('port')}</th>
                {isProfileMode ? <th>{t('pid')}</th> : null}
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {fleet.instances.map((instance) => (
                <tr key={instance.id}>
                  <td className="mono">{instance.id}</td>
                  <td>{instance.status}</td>
                  <td>{instance.health}</td>
                  <td className="mono">:{instance.port}</td>
                  {isProfileMode ? <td className="mono">{instance.pid ?? '-'}</td> : null}
                  <td>
                    <div className="action-row">
                      <button className="secondary-button" onClick={() => onOpenInstance(instance.id)}>
                        {t('openProfile')}
                      </button>
                      {isProfileMode ? (
                        <button
                          className="danger-button"
                          onClick={() => setPendingDelete(instance.id)}
                          disabled={deleteMutation.isPending}
                        >
                          {t('delete')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddProfile ? <AddProfileDialog onClose={() => setShowAddProfile(false)} /> : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={t('deleteProfileTitle')}
        message={t('deleteProfileConfirm', { profile: pendingDelete ?? '' })}
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
          {deleteMutation.error instanceof Error ? deleteMutation.error.message : t('deleteProfileFailed')}
        </p>
      ) : null}
    </section>
  );
}
