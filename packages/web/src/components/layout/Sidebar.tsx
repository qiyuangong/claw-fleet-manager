import { useState } from 'react';
import { AddProfileDialog } from '../instances/AddProfileDialog';
import { useFleet } from '../../hooks/useFleet';
import { selectedInstanceIdSelector, useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';

export function Sidebar() {
  const { data, isLoading, error } = useFleet();
  const activeView = useAppStore((state) => state.activeView);
  const currentUser = useAppStore((state) => state.currentUser);
  const selectedInstanceId = useAppStore(selectedInstanceIdSelector);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const selectConfig = useAppStore((state) => state.selectConfig);
  const selectUsers = useAppStore((state) => state.selectUsers);
  const selectAccount = useAppStore((state) => state.selectAccount);
  const [showAddProfile, setShowAddProfile] = useState(false);

  const visibleInstances = data?.instances.filter((instance) => {
    if (!currentUser || currentUser.role === 'admin') return true;
    return (currentUser.assignedProfiles ?? []).includes(instance.id);
  }) ?? [];

  const isProfileMode = data?.mode === 'profiles';
  const canManageFleet = currentUser?.role === 'admin';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="pill">Fleet Manager</p>
        <h1 className="sidebar-title">Claw Fleet</h1>
        <p className="sidebar-subtitle">
          {data ? `${data.totalRunning}/${visibleInstances.length} running` : isLoading ? 'Loading fleet...' : 'Awaiting server'}
        </p>
        {error ? <p className="error-text">{error.message}</p> : null}
      </div>

      <nav className="sidebar-nav">
        {currentUser?.role !== 'admin' ? (
          <>
            <p className="sidebar-section">Account</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'account' ? ' selected' : ''}`}
              onClick={selectAccount}
            >
              My Account
            </button>
          </>
        ) : null}

        <p className="sidebar-section">Instances</p>
        {visibleInstances.map((instance) => (
          <SidebarItem
            key={instance.id}
            instance={instance}
            selected={instance.id === selectedInstanceId}
            onClick={() => selectInstance(instance.id)}
          />
        ))}

        {currentUser?.role === 'admin' ? (
          <>
            <p className="sidebar-section">Admin</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'users' ? ' selected' : ''}`}
              onClick={selectUsers}
            >
              Users
            </button>
          </>
        ) : null}
      </nav>

      <div className="sidebar-footer">
        {isProfileMode && canManageFleet ? (
          <button className="primary-button" onClick={() => setShowAddProfile(true)}>
            + Add Profile
          </button>
        ) : null}
        {canManageFleet ? (
          <button className="secondary-button" onClick={selectConfig}>
            Fleet Config
          </button>
        ) : null}
      </div>

      {showAddProfile ? <AddProfileDialog onClose={() => setShowAddProfile(false)} /> : null}
    </aside>
  );
}
