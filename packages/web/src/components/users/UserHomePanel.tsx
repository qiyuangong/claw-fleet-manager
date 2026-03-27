import type { FleetInstance, PublicUser } from '../../types';

interface Props {
  user: PublicUser;
  instances: FleetInstance[];
  onOpenInstance: (id: string) => void;
  onChangePassword: () => void;
}

export function UserHomePanel({ user, instances, onOpenInstance, onChangePassword }: Props) {
  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">My Account</p>
          <h2 className="panel-title">{user.username}</h2>
          <p className="muted">Access your assigned profiles and account settings.</p>
        </div>
      </div>

      <div className="action-row" style={{ marginBottom: '1.25rem' }}>
        <button className="secondary-button" onClick={onChangePassword}>
          Change Password
        </button>
      </div>

      <div className="section-grid">
        <section className="metric-card">
          <p className="metric-label">Role</p>
          <p className="metric-value">{user.role}</p>
        </section>
        <section className="metric-card">
          <p className="metric-label">Assigned Profiles</p>
          <p className="metric-value">{instances.length}</p>
        </section>
      </div>

      <div style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>My Profiles</h3>
        {instances.length === 0 ? (
          <p className="muted">No profile is assigned to this account yet.</p>
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
