import { useEffect, useState } from 'react';
import { FleetConfigPanel } from '../config/FleetConfigPanel';
import { InstancePanel } from '../instances/InstancePanel';
import { ChangePasswordDialog } from '../users/ChangePasswordDialog';
import { UserManagementPanel } from '../users/UserManagementPanel';
import { Sidebar } from './Sidebar';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useAppStore } from '../../store';

export function Shell() {
  const activeView = useAppStore((state) => state.activeView);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const { data: currentUser } = useCurrentUser();
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    setCurrentUser(currentUser ?? null);
  }, [currentUser, setCurrentUser]);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <div className="main-panel-topbar">
          {currentUser ? (
            <button className="account-indicator" onClick={() => setShowChangePassword(true)}>
              {currentUser.username} ({currentUser.role})
            </button>
          ) : null}
        </div>
        {activeView.type === 'instance' ? (
          <InstancePanel instanceId={activeView.id} />
        ) : activeView.type === 'users' ? (
          <UserManagementPanel />
        ) : (
          <FleetConfigPanel />
        )}
      </main>
      {showChangePassword && currentUser ? (
        <ChangePasswordDialog
          username={currentUser.username}
          isAdmin={currentUser.role === 'admin'}
          onClose={() => setShowChangePassword(false)}
        />
      ) : null}
    </div>
  );
}
