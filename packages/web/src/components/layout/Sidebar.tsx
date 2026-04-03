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
  const selectAccount = useAppStore((state) => state.selectAccount);

  const visibleInstances = data?.instances.filter((instance) => {
    if (!currentUser || currentUser.role === 'admin') return true;
    return (currentUser.assignedProfiles ?? []).includes(instance.id);
  }) ?? [];

  const isProfileMode = data?.mode === 'profiles';
  const instanceSectionLabel = isProfileMode ? t('profiles') : t('instances');
  const manageInstancesLabel = isProfileMode ? t('manageProfiles') : t('manageInstances');
  const subtitle = data
    ? isProfileMode
      ? t('profilesRunning', { running: data.totalRunning, total: visibleInstances.length })
      : t('running', { running: data.totalRunning, total: visibleInstances.length })
    : isLoading
      ? t('loadingFleet')
      : t('awaitingServer');

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
        {isProfileMode ? <p className="sidebar-subtitle">{t('profileModeSummary')}</p> : null}
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

        <p className="sidebar-section">{instanceSectionLabel}</p>
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
            <p className="sidebar-section">{t('admin')}</p>
            <button
              className={`sidebar-nav-item${activeView.type === 'instances' ? ' selected' : ''}`}
              onClick={selectInstances}
            >
              {manageInstancesLabel}
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

      <div className="sidebar-footer">
        {isProfileMode ? <p className="sidebar-hint">{t('profileModeHint')}</p> : null}
      </div>
    </aside>
  );
}
