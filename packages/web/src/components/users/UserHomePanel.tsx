import { useTranslation } from 'react-i18next';
import type { FleetInstance, PublicUser } from '../../types';

interface Props {
  user: PublicUser;
  instances: FleetInstance[];
  onOpenInstance: (id: string) => void;
  onChangePassword: () => void;
}

export function UserHomePanel({ user, instances, onOpenInstance, onChangePassword }: Props) {
  const { t } = useTranslation();

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">{t('myAccountPill')}</p>
          <h2 className="panel-title">{user.username}</h2>
          <p className="muted">{t('myAccountDesc')}</p>
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
        {instances.length === 0 ? (
          <p className="muted">{t('noProfileAssigned')}</p>
        ) : (
          <div className="profile-list">
            {instances.map((instance) => (
              <button
                key={instance.id}
                className="profile-card"
                onClick={() => onOpenInstance(instance.id)}
              >
                <div>
                  <div className="mono">{instance.id}</div>
                  <div className="muted">{instance.status} · {instance.health}</div>
                </div>
                <span className="sidebar-item-meta mono">:{instance.port}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
