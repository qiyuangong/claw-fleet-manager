import { Suspense, lazy } from 'react';
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

const baseTabs = ['overview', 'logs', 'config', 'metrics', 'controlui', 'feishu'] as const;

type Tab = typeof baseTabs[number] | 'plugins';

const tabLabelKey: Record<Tab, string> = {
  overview: 'tabOverview',
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
          <h2 className="panel-title">{t('instanceControl')}</h2>
          <p className="muted">{t('instanceControlDesc')}</p>
        </div>
      </div>

      <div className="tab-row">
        {[...baseTabs, ...(instance.profile ? (['plugins'] as const) : [])].map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setTab(tab)}
          >
            {t(tabLabelKey[tab])}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? <OverviewTab instance={instance} /> : null}
      {activeTab !== 'overview' ? (
        <Suspense fallback={<div className="panel-card muted">{t('loadingTab')}</div>}>
          {activeTab === 'logs' ? <LogsTab instanceId={instanceId} /> : null}
          {activeTab === 'config' ? <ConfigTab instanceId={instanceId} /> : null}
          {activeTab === 'metrics' ? <MetricsTab instance={instance} /> : null}
          {activeTab === 'controlui' ? <ControlUiTab instance={instance} /> : null}
          {activeTab === 'feishu' ? <FeishuTab instanceId={instanceId} /> : null}
          {activeTab === 'plugins' ? <PluginsTab instance={instance} /> : null}
        </Suspense>
      ) : null}
    </section>
  );
}
