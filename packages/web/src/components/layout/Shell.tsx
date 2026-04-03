import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  clearApiClientSessionAuth,
  enableApiClientAuth,
  isApiClientLoggedOut,
  logoutApiClient,
  setApiClientSessionAuth,
} from '../../api/client';
import { getCurrentUser } from '../../api/users';
import { FleetConfigPanel } from '../config/FleetConfigPanel';
import { InstancePanel } from '../instances/InstancePanel';
import { InstanceManagementPanel } from '../instances/InstanceManagementPanel';
import { ChangePasswordDialog } from '../users/ChangePasswordDialog';
import { UserHomePanel } from '../users/UserHomePanel';
import { UserManagementPanel } from '../users/UserManagementPanel';
import { useFleet } from '../../hooks/useFleet';
import { Sidebar } from './Sidebar';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useAppStore } from '../../store';

export function Shell() {
  const { t } = useTranslation();
  const activeView = useAppStore((state) => state.activeView);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const selectAccount = useAppStore((state) => state.selectAccount);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const { data: currentUser, error: currentUserError, isLoading: currentUserLoading } = useCurrentUser();
  const { data: fleet } = useFleet();
  const queryClient = useQueryClient();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [loggedOut, setLoggedOut] = useState(() => isApiClientLoggedOut());
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const nonAdminAllowedInstances = useMemo(
    () => (currentUser && currentUser.role !== 'admin' && fleet
      ? fleet.instances.filter((instance) => (currentUser.assignedProfiles ?? []).includes(instance.id))
      : []),
    [currentUser, fleet],
  );

  useEffect(() => {
    setCurrentUser(currentUser ?? null);
  }, [currentUser, setCurrentUser]);

  useEffect(() => {
    if (!currentUser || currentUser.role === 'admin' || !fleet) return;
    if (activeView.type === 'account') return;
    if (activeView.type === 'instance' && nonAdminAllowedInstances.some((instance) => instance.id === activeView.id)) return;
    selectAccount();
  }, [activeView, currentUser, fleet, nonAdminAllowedInstances, selectAccount]);

  const handleLogout = () => {
    clearApiClientSessionAuth();
    logoutApiClient();
    setLoggedOut(true);
    setCurrentUser(null);
    queryClient.clear();
  };

  const handleLoginAgain = async () => {
    setLoggingIn(true);
    setLoginError('');
    enableApiClientAuth();
    clearApiClientSessionAuth();
    setLoggedOut(false);
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      queryClient.setQueryData(['currentUser'], user);
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    } catch {
      setLoggedOut(true);
      setLoginError(t('defaultAuthUnavailable'));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleSignIn = async () => {
    if (!loginUsername.trim() || !loginPassword) {
      setLoginError(t('usernamePasswordRequired'));
      return;
    }
    setLoggingIn(true);
    setLoggedOut(false);
    setApiClientSessionAuth(loginUsername.trim(), loginPassword);
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      setLoginError('');
      queryClient.setQueryData(['currentUser'], user);
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
    } catch {
      setLoggedOut(true);
      clearApiClientSessionAuth();
      setLoginError(t('invalidCredentials'));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLoginKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !loggingIn) {
      void handleSignIn();
    }
  };

  if (!currentUser && (loggedOut || currentUserError) && !currentUserLoading) {
    return (
      <main className="empty-state">
        <section className="panel-card auth-card">
          <h2 style={{ marginTop: 0 }}>{t('signedOut')}</h2>
          <p className="muted">{t('signInAgain')}</p>
          <p className="muted">{t('signInHelp')}</p>
          <div className="field-grid" style={{ marginTop: '0.75rem' }}>
            <label className="field-label">
              <span>{t('usernameLabel')}</span>
              <input
                className="text-input"
                placeholder={t('usernamePlaceholder')}
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                onKeyDown={handleLoginKeyDown}
              />
            </label>
            <label className="field-label">
              <span>{t('passwordLabel')}</span>
              <input
                className="text-input"
                type="password"
                placeholder={t('passwordPlaceholder')}
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                onKeyDown={handleLoginKeyDown}
              />
            </label>
          </div>
          <div className="action-row stacked-actions" style={{ marginTop: '1rem' }}>
            <button className="primary-button" onClick={() => void handleSignIn()} disabled={loggingIn}>
              {loggingIn ? t('signingIn') : t('signIn')}
            </button>
            <button className="secondary-button" onClick={() => void handleLoginAgain()} disabled={loggingIn}>
              {t('useDefaultAuth')}
            </button>
          </div>
          {loginError ? <p className="error-text" style={{ marginBottom: 0 }}>{loginError}</p> : null}
        </section>
      </main>
    );
  }

  if (!currentUser && currentUserLoading) {
    return (
      <main className="empty-state">
        <section className="panel-card">
          <h2 style={{ marginTop: 0 }}>{t('loadingSession')}</h2>
          <p className="muted">{t('checkingAccount')}</p>
        </section>
      </main>
    );
  }

  if (currentUser && currentUser.role !== 'admin' && !fleet) {
    return (
      <div className="app-shell">
        <Sidebar />
        <main className="empty-state">
          <section className="panel-card">
            <h2 style={{ marginTop: 0 }}>{t('loadingInstances')}</h2>
            <p className="muted">{t('resolvingInstances')}</p>
          </section>
        </main>
      </div>
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
                {t('logout')}
              </button>
            </div>
          ) : null}
        </div>
        {currentUser && currentUser.role !== 'admin' && activeView.type === 'account' ? (
          <UserHomePanel
            user={currentUser}
            instances={nonAdminAllowedInstances}
            onOpenInstance={selectInstance}
            onChangePassword={() => setShowChangePassword(true)}
          />
        ) : activeView.type === 'instance' ? (
          <InstancePanel instanceId={activeView.id} />
        ) : activeView.type === 'instances' ? (
          <InstanceManagementPanel onOpenInstance={selectInstance} />
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
