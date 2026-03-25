import { Suspense, lazy } from 'react';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { OverviewTab } from './OverviewTab';

const LogsTab = lazy(async () => ({ default: (await import('./LogsTab')).LogsTab }));
const ConfigTab = lazy(async () => ({ default: (await import('./ConfigTab')).ConfigTab }));
const MetricsTab = lazy(async () => ({ default: (await import('./MetricsTab')).MetricsTab }));
const ControlUiTab = lazy(async () => ({ default: (await import('./ControlUiTab')).ControlUiTab }));
const FeishuTab = lazy(async () => ({ default: (await import('./FeishuTab')).FeishuTab }));

const tabs = ['overview', 'logs', 'config', 'metrics', 'controlui', 'feishu'] as const;

export function InstancePanel({ instanceId }: { instanceId: string }) {
  const { data } = useFleet();
  const activeTab = useAppStore((state) => state.activeTab);
  const setTab = useAppStore((state) => state.setTab);
  const instance = data?.instances.find((item) => item.id === instanceId);

  if (!instance) {
    return (
      <section className="empty-state">
        <div>
          <h2>Instance not found</h2>
          <p className="muted">The selected instance is not present in the latest fleet snapshot.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill mono">{instance.id}</p>
          <h2 className="panel-title">Instance Control</h2>
          <p className="muted">Inspect state, tail logs, edit config, and watch metrics.</p>
        </div>
      </div>

      <div className="tab-row">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setTab(tab)}
          >
            {tab === 'controlui' ? 'control ui' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? <OverviewTab instance={instance} /> : null}
      {activeTab !== 'overview' ? (
        <Suspense fallback={<div className="panel-card muted">Loading tab...</div>}>
          {activeTab === 'logs' ? <LogsTab instanceId={instanceId} /> : null}
          {activeTab === 'config' ? <ConfigTab instanceId={instanceId} /> : null}
          {activeTab === 'metrics' ? <MetricsTab instance={instance} /> : null}
          {activeTab === 'controlui' ? <ControlUiTab instance={instance} /> : null}
          {activeTab === 'feishu' ? <FeishuTab instanceId={instanceId} /> : null}
        </Suspense>
      ) : null}
    </section>
  );
}
