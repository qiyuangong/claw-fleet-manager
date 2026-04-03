import { useTranslation } from 'react-i18next';
import type { FleetInstance, PublicUser } from '../../types';

import { StatusBadge } from '../common/StatusBadge';

interface Props {
  user: PublicUser;
  instances: FleetInstance[];
  onOpenInstance: (id: string) => void;
  onChangePassword: () => void;
}

export function UserHomePanel({ user, instances, onOpenInstance, onChangePassword }: Props) {
  const { t } = useTranslation();
  const profileCountLabel = t(instances.length === 1 ? 'assignedProfilesSingle' : 'assignedProfilesPlural', {
    count: instances.length,
  });

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">{t('myAccountPill')}</p>
          <h2 className="panel-title">{user.username}</h2>
          <p className="muted">{t('myAccountDescFriendly', { countLabel: profileCountLabel })}</p>
        </div>
      </div>

      <div className="action-row" style={{ marginBottom: '1.25rem' }}>
        <button className="secondary-button" onClick={onChangePassword}>
          {t('changePassword')}
        </button>
      </div>

      <div className="section-grid">
        <section className="metric-card">
          <p className="metric-label">{t('role')}</p>
          <p className="metric-value">{user.role}</p>
        </section>
        <section className="metric-card">
          <p className="metric-label">{t('assignedProfiles')}</p>
          <p className="metric-value">{instances.length}</p>
        </section>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>{t('myProfiles')}</h3>
        <p className="muted">{t('myProfilesHelp')}</p>
        {instances.length === 0 ? (
          <div className="profile-empty-state">
            <p style={{ margin: 0 }}>{t('noProfileAssigned')}</p>
            <p className="muted" style={{ margin: 0 }}>{t('noProfileAssignedHelp')}</p>
          </div>
        ) : (
          <div className="profile-list">
            {instances.map((instance) => (
              <button
                key={instance.id}
                className="profile-card"
                onClick={() => onOpenInstance(instance.id)}
              >
                <div>
                  <div className="profile-card-title">
                    <StatusBadge status={instance.status} />
                    <span className="mono">{instance.id}</span>
                  </div>
                  <div className="muted">{t('profileCardMeta', { health: instance.health, port: instance.port })}</div>
                </div>
                <span className="profile-card-action">{t('openProfile')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
