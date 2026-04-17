import { Suspense, lazy, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { OverviewTab } from './OverviewTab';

const LogsTab = lazy(async () => ({ default: (await import('./LogsTab')).LogsTab }));
const ConfigTab = lazy(async () => ({ default: (await import('./ConfigTab')).ConfigTab }));
const MetricsTab = lazy(async () => ({ default: (await import('./MetricsTab')).MetricsTab }));
const ControlUiTab = lazy(async () => ({ default: (await import('./ControlUiTab')).ControlUiTab }));
const FeishuTab = lazy(async () => ({ default: (await import('./FeishuTab')).FeishuTab }));
const PluginsTab = lazy(async () => ({ default: (await import('./PluginsTab')).PluginsTab }));
const InstanceActivityTab = lazy(async () => ({ default: (await import('./InstanceActivityTab')).InstanceActivityTab }));

type Tab = 'overview' | 'activity' | 'logs' | 'config' | 'metrics' | 'controlui' | 'feishu' | 'plugins';

const tabLabelKey: Record<Tab, string> = {
  overview: 'tabOverview',
  activity: 'tabActivity',
  logs: 'tabLogs',
  config: 'tabConfig',
  metrics: 'tabMetrics',
  controlui: 'tabControlUi',
  feishu: 'tabFeishu',
  plugins: 'tabPlugins',
};

export function InstancePanel({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const { data } = useFleet();
  const activeTab = useAppStore((state) => state.activeTab);
  const setTab = useAppStore((state) => state.setTab);
  const instance = data?.instances.find((item) => item.id === instanceId);
  const tabs: Tab[] = [
    'overview',
    ...(instance?.runtimeCapabilities.sessions ? ['activity'] as const : []),
    ...(instance?.runtimeCapabilities.logs ? ['logs'] as const : []),
    ...(instance?.runtimeCapabilities.configEditor ? ['config'] as const : []),
    'metrics',
    ...(instance?.runtimeCapabilities.proxyAccess ? ['controlui'] as const : []),
    ...(instance?.runtime === 'openclaw' ? ['feishu'] as const : []),
    ...(instance?.runtimeCapabilities.plugins ? ['plugins'] as const : []),
  ];
  const resolvedTab = tabs.includes(activeTab) ? activeTab : 'overview';

  useEffect(() => {
    if (!instance) return;
    if (resolvedTab !== activeTab) {
      setTab(resolvedTab);
    }
  }, [activeTab, instance, resolvedTab, setTab]);

  if (!instance) {
    return (
      <section className="empty-state">
        <div>
          <h2>{t('instanceNotFound')}</h2>
          <p className="muted">{t('instanceNotFoundDesc')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill mono">{instance.profile ?? instance.id}</p>
          <h2 className="panel-title">{t('instanceWorkspace')}</h2>
          <p className="muted">{t('instanceWorkspaceDesc')}</p>
        </div>
      </div>

      <div className="tab-row">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${resolvedTab === tab ? 'active' : ''}`}
            onClick={() => setTab(tab)}
          >
            {t(tabLabelKey[tab])}
          </button>
        ))}
      </div>

      {resolvedTab === 'overview' ? <OverviewTab instance={instance} /> : null}
      {resolvedTab !== 'overview' ? (
        <Suspense fallback={<div className="panel-card muted">{t('loadingTab')}</div>}>
          {resolvedTab === 'activity' ? <InstanceActivityTab instanceId={instanceId} /> : null}
          {resolvedTab === 'logs' ? <LogsTab instanceId={instanceId} /> : null}
          {resolvedTab === 'config' ? <ConfigTab instanceId={instanceId} /> : null}
          {resolvedTab === 'metrics' ? <MetricsTab instance={instance} /> : null}
          {resolvedTab === 'controlui' ? <ControlUiTab instance={instance} /> : null}
          {resolvedTab === 'feishu' ? <FeishuTab instanceId={instanceId} /> : null}
          {resolvedTab === 'plugins' ? <PluginsTab instance={instance} /> : null}
        </Suspense>
      ) : null}
    </section>
  );
}
