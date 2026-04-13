import { useTranslation } from 'react-i18next';
import { useFleet } from '../../hooks/useFleet';
import { selectedInstanceIdSelector, useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';
import { setLanguage } from '../../i18n';

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const { data, isLoading, error } = useFleet();
  const activeView = useAppStore((state) => state.activeView);
  const currentUser = useAppStore((state) => state.currentUser);
  const selectedInstanceId = useAppStore(selectedInstanceIdSelector);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const selectInstances = useAppStore((state) => state.selectInstances);
  const selectConfig = useAppStore((state) => state.selectConfig);
  const selectUsers = useAppStore((state) => state.selectUsers);
  const selectDashboard = useAppStore((state) => state.selectDashboard);
  const selectSessions = useAppStore((state) => state.selectSessions);
  const selectAccount = useAppStore((state) => state.selectAccount);

  const visibleInstances = data?.instances.filter((instance) => {
    if (!currentUser || currentUser.role === 'admin') return true;
    return (currentUser.assignedProfiles ?? []).includes(instance.id);
  }) ?? [];

  const subtitle = data
    ? t('instancesReady', { running: data.totalRunning, total: visibleInstances.length })
    : isLoading
      ? t('loadingFleet')
      : t('awaitingServer');
  const showInstanceList = currentUser?.role !== 'admin';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <p className="pill">{t('fleetManager')}</p>
          <select
            className="lang-select"
            value={i18n.language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
            aria-label="Language"
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
        </div>
        <h1 className="sidebar-title">{t('clawFleet')}</h1>
        <p className="sidebar-subtitle">{subtitle}</p>
        {error ? <p className="error-text">{error.message}</p> : null}
      </div>

      <nav className="sidebar-nav">
        {currentUser?.role !== 'admin' ? (
          <>
            <p className="sidebar-section">{t('account')}</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'account' ? ' selected' : ''}`}
              onClick={selectAccount}
            >
              {t('myAccount')}
            </button>
          </>
        ) : null}

        {showInstanceList ? (
          <>
            <p className="sidebar-section">{t('instances')}</p>
            {visibleInstances.map((instance) => (
              <SidebarItem
                key={instance.id}
                instance={instance}
                selected={instance.id === selectedInstanceId}
                onClick={() => selectInstance(instance.id)}
              />
            ))}
          </>
        ) : null}

        {currentUser?.role === 'admin' ? (
          <>
            <p className="sidebar-section">{t('admin')}</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'dashboard' ? ' selected' : ''}`}
              onClick={selectDashboard}
            >
              {t('dashboard')}
            </button>
            <button
              className={`sidebar-nav-item${activeView.type === 'instances' ? ' selected' : ''}`}
              onClick={selectInstances}
            >
              {t('manageInstances')}
            </button>
            <button
              className={`sidebar-nav-item${activeView.type === 'sessions' ? ' selected' : ''}`}
              onClick={selectSessions}
            >
              {t('manageSessions')}
            </button>
            <button
              className={`sidebar-nav-item${activeView.type === 'users' ? ' selected' : ''}`}
              onClick={selectUsers}
            >
              {t('users')}
            </button>
            <button
              className={`sidebar-nav-item${activeView.type === 'config' ? ' selected' : ''}`}
              onClick={selectConfig}
            >
              {t('fleetConfig')}
            </button>
          </>
        ) : null}
      </nav>
    </aside>
  );
}
