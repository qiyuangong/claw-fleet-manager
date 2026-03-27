import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { enableApiClientAuth, logoutApiClient } from '../../api/client';
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
  const { data: currentUser, error: currentUserError, isLoading: currentUserLoading } = useCurrentUser();
  const queryClient = useQueryClient();
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    setCurrentUser(currentUser ?? null);
  }, [currentUser, setCurrentUser]);

  const handleLogout = () => {
    logoutApiClient();
    setCurrentUser(null);
    queryClient.clear();
    window.location.reload();
  };

  const handleLoginAgain = () => {
    enableApiClientAuth();
    queryClient.clear();
    window.location.reload();
  };

  if (!currentUser && currentUserError && !currentUserLoading) {
    return (
      <main className="empty-state">
        <section className="panel-card">
          <h2 style={{ marginTop: 0 }}>Signed out</h2>
          <p className="muted">You are logged out. Sign in again to continue.</p>
          <button className="primary-button" onClick={handleLoginAgain}>
            Sign In Again
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <div className="main-panel-topbar">
          {currentUser ? (
            <div className="account-actions">
              <button className="account-indicator" onClick={() => setShowChangePassword(true)}>
                {currentUser.username} ({currentUser.role})
              </button>
              <button className="secondary-button" onClick={handleLogout}>
                Logout
              </button>
            </div>
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
