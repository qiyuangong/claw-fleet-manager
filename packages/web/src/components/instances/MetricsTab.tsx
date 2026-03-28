import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTranslation } from 'react-i18next';
import type { FleetInstance } from '../../types';

interface DataPoint {
  time: string;
  cpu: number;
  memory: number;
}

interface HistoryCacheEntry {
  lastUpdatedAt: number;
  points: DataPoint[];
  sampleKey: string;
}

const MAX_POINTS = 120;
const MAX_CACHED_INSTANCES = 24;
const historyByInstance = new Map<string, HistoryCacheEntry>();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

export function MetricsTab({ instance }: { instance: FleetInstance }) {
  const { t } = useTranslation();
  const history = getHistory(instance);

  return (
    <div className="field-grid">
      <section className="panel-card">
        <h3 style={{ marginTop: 0 }}>{t('cpuHistory')}</h3>
        <div className="chart-shell" style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <XAxis dataKey="time" tick={{ fill: '#94a5c6', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a5c6', fontSize: 11 }} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="cpu" stroke="#7be0ff" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel-card">
        <h3 style={{ marginTop: 0 }}>{t('memoryHistory')}</h3>
        <div className="chart-shell" style={{ height: '220px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <XAxis dataKey="time" tick={{ fill: '#94a5c6', fontSize: 11 }} />
              <YAxis tick={{ fill: '#94a5c6', fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="memory" stroke="#ffcb70" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section-grid">
        <div className="metric-card">
          <p className="metric-label">{t('configVolume')}</p>
          <p className="metric-value mono">{formatBytes(instance.disk.config)}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">{t('workspaceVolume')}</p>
          <p className="metric-value mono">{formatBytes(instance.disk.workspace)}</p>
        </div>
      </section>
    </div>
  );
}

function getHistory(instance: FleetInstance): DataPoint[] {
  const sampleKey = `${instance.cpu}:${instance.memory.used}`;
  const cached = historyByInstance.get(instance.id);
  if (cached?.sampleKey === sampleKey) {
    cached.lastUpdatedAt = Date.now();
    return cached.points;
  }

  const point: DataPoint = {
    time: new Date().toLocaleTimeString(),
    cpu: instance.cpu,
    memory: instance.memory.used / (1024 * 1024),
  };
  const points = [...(cached?.points ?? []), point].slice(-MAX_POINTS);
  historyByInstance.set(instance.id, {
    lastUpdatedAt: Date.now(),
    sampleKey,
    points,
  });
  pruneHistoryCache();
  return points;
}

function pruneHistoryCache() {
  if (historyByInstance.size <= MAX_CACHED_INSTANCES) {
    return;
  }

  const oldestInstanceId = [...historyByInstance.entries()]
    .sort(([, left], [, right]) => left.lastUpdatedAt - right.lastUpdatedAt)[0]?.[0];

  if (oldestInstanceId) {
    historyByInstance.delete(oldestInstanceId);
  }
}
