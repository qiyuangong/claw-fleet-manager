import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FleetInstance } from '../../types';
import {
  columnLabelKey,
  formatCost,
  formatTokens,
  sessionTimestamp,
  type FlatRow,
} from './activityViewModel';

const STATUS_KEYS = ['running', 'done', 'failed', 'killedTimeout', 'other'] as const;
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

type StatusKey = (typeof STATUS_KEYS)[number];
export type DashboardStatusFocus = StatusKey | 'all';

type RankItem = {
  label: string;
  value: number;
  metric: string;
  meta: string;
  onClick?: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function statusBucket(row: FlatRow): StatusKey {
  if (row.session.status === 'running') return 'running';
  if (row.session.status === 'done') return 'done';
  if (row.session.status === 'failed') return 'failed';
  if (row.session.status === 'killed' || row.session.status === 'timeout') return 'killedTimeout';
  return 'other';
}

function hourLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], {
    month: 'numeric',
    day: 'numeric',
  });
}

function RankPanel({ items }: { items: RankItem[] }) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <ol className="activity-rank-list">
      {items.map((item) => (
        <li key={item.label} className="activity-rank-item">
          {item.onClick ? (
            <button type="button" className="activity-rank-button" onClick={item.onClick}>
              <div className="activity-rank-row">
                <span className="activity-rank-label" title={item.label}>{item.label}</span>
                <span className="activity-rank-value">{item.metric}</span>
              </div>
              <div className="activity-rank-bar">
                <span style={{ width: `${(item.value / maxValue) * 100}%` }} />
              </div>
              <div className="activity-rank-meta">{item.meta}</div>
            </button>
          ) : (
            <>
              <div className="activity-rank-row">
                <span className="activity-rank-label" title={item.label}>{item.label}</span>
                <span className="activity-rank-value">{item.metric}</span>
              </div>
              <div className="activity-rank-bar">
                <span style={{ width: `${(item.value / maxValue) * 100}%` }} />
              </div>
              <div className="activity-rank-meta">{item.meta}</div>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Dashboard({
  rows,
  throughputRows,
  instances,
  statusFocus,
  onStatusFocusChange,
  onSearchQueryChange,
}: {
  rows: FlatRow[];
  throughputRows: FlatRow[];
  instances: FleetInstance[];
  statusFocus: DashboardStatusFocus;
  onStatusFocusChange: (focus: DashboardStatusFocus) => void;
  onSearchQueryChange: (query: string) => void;
}) {
  const { t } = useTranslation();
  const [trendWindow, setTrendWindow] = useState<'24h' | '7d'>('24h');
  const [throughputNow, setThroughputNow] = useState(() => Date.now());

  const totalSessions = rows.length;
  const runningSessions = rows.filter((row) => row.session.status === 'running').length;
  const activeInstances = new Set(rows.map((row) => row.instanceId)).size;
  const hasCostData = rows.some((row) => row.session.estimatedCostUsd != null);
  const cpuAverage = instances.length > 0
    ? instances.reduce((sum, instance) => sum + Math.max(0, instance.cpu), 0) / instances.length
    : 0;
  const cpuPercent = Math.max(0, Math.min(cpuAverage, 100));
  const memoryUsedTotal = instances.reduce((sum, instance) => sum + Math.max(0, instance.memory.used), 0);
  const memoryLimitTotal = instances.reduce(
    (sum, instance) => sum + (instance.memory.limit > 0 ? instance.memory.limit : 0),
    0,
  );
  const memoryPercent = memoryLimitTotal > 0
    ? Math.max(0, Math.min((memoryUsedTotal / memoryLimitTotal) * 100, 100))
    : 0;

  const statusCounts = STATUS_KEYS.map((key) => ({
    key,
    count: rows.filter((row) => statusBucket(row) === key).length,
  }));

  const bucketCount = trendWindow === '24h' ? 12 : 7;
  const bucketMs = trendWindow === '24h' ? 2 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const { throughputBuckets, throughputMax } = useMemo(() => {
    const rangeStart = throughputNow - bucketCount * bucketMs;
    const nextThroughputBuckets = Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = rangeStart + index * bucketMs;
      const bucketEnd = bucketStart + bucketMs;
      const count = throughputRows.filter((row) => {
        const ts = sessionTimestamp(row.session) ?? 0;
        return ts >= bucketStart && ts < bucketEnd;
      }).length;

      return {
        label: trendWindow === '24h' ? hourLabel(bucketEnd) : dayLabel(bucketEnd),
        count,
      };
    });

    return {
      throughputBuckets: nextThroughputBuckets,
      throughputMax: Math.max(...nextThroughputBuckets.map((bucket) => bucket.count), 1),
    };
  }, [bucketCount, bucketMs, throughputNow, throughputRows, trendWindow]);

  const runtimeBuckets = [
    { key: 'live', label: t('dashboardRuntimeLive'), count: 0 },
    { key: 'short', label: t('dashboardRuntimeShort'), count: 0 },
    { key: 'medium', label: t('dashboardRuntimeMedium'), count: 0 },
    { key: 'long', label: t('dashboardRuntimeLong'), count: 0 },
    { key: 'extended', label: t('dashboardRuntimeExtended'), count: 0 },
  ];
  for (const row of rows) {
    if (row.session.status === 'running') {
      runtimeBuckets[0].count += 1;
      continue;
    }
    const runtimeMs = row.session.runtimeMs ?? 0;
    if (runtimeMs < 5 * 60 * 1000) {
      runtimeBuckets[1].count += 1;
    } else if (runtimeMs < 30 * 60 * 1000) {
      runtimeBuckets[2].count += 1;
    } else if (runtimeMs < 2 * 60 * 60 * 1000) {
      runtimeBuckets[3].count += 1;
    } else {
      runtimeBuckets[4].count += 1;
    }
  }
  const runtimeMax = Math.max(...runtimeBuckets.map((bucket) => bucket.count), 1);

  const byInstance = new Map<string, { sessions: number; tokens: number; cost: number }>();
  for (const row of rows) {
    const entry = byInstance.get(row.instanceId) ?? { sessions: 0, tokens: 0, cost: 0 };
    entry.sessions += 1;
    entry.tokens += row.session.totalTokens ?? 0;
    entry.cost += row.session.estimatedCostUsd ?? 0;
    byInstance.set(row.instanceId, entry);
  }
  const topInstances = [...byInstance.entries()]
    .sort((a, b) => b[1].sessions - a[1].sessions || b[1].tokens - a[1].tokens)
    .slice(0, 5)
    .map(([label, value]) => ({
      label,
      value: value.sessions,
      metric: compactNumber.format(value.sessions),
      meta: `${formatTokens(value.tokens)} • ${hasCostData ? formatCost(value.cost) : '$—'}`,
      onClick: () => onSearchQueryChange(label),
    }));

  const byModel = new Map<string, { sessions: number; tokens: number }>();
  for (const row of rows) {
    const label = row.session.model?.trim() || 'unknown';
    const entry = byModel.get(label) ?? { sessions: 0, tokens: 0 };
    entry.sessions += 1;
    entry.tokens += row.session.totalTokens ?? 0;
    byModel.set(label, entry);
  }
  const topModels = [...byModel.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens || b[1].sessions - a[1].sessions)
    .slice(0, 5)
    .map(([label, value]) => ({
      label,
      value: value.tokens,
      metric: formatTokens(value.tokens),
      meta: `${compactNumber.format(value.sessions)} ${t('dashboardSessionsUnit')}`,
      onClick: () => onSearchQueryChange(label === 'unknown' ? '' : label),
    }));

  return (
    <div className="dashboard">
      <div className="activity-metric-grid">
        <div className="activity-metric-card">
          <span className="activity-metric-label">{t('sessionsCount')}</span>
          <strong className="activity-metric-value">{compactNumber.format(totalSessions)}</strong>
        </div>
        <div className="activity-metric-card">
          <span className="activity-metric-label">{t('dashboardActiveInstances')}</span>
          <strong className="activity-metric-value">{compactNumber.format(activeInstances)}</strong>
        </div>
        <button
          type="button"
          className={`activity-metric-card activity-metric-card--button activity-metric-card--running${statusFocus === 'running' ? ' activity-metric-card--active' : ''}`}
          onClick={() => onStatusFocusChange(statusFocus === 'running' ? 'all' : 'running')}
        >
          <span className="activity-metric-label">{t('dashboardRunningNow')}</span>
          <strong className="activity-metric-value">{compactNumber.format(runningSessions)}</strong>
        </button>
        <div className="activity-metric-card">
          <span className="activity-metric-label">{t('dashboardCpuUsage')}</span>
          <strong className="activity-metric-value">{cpuAverage.toFixed(1)}%</strong>
          <div className="activity-runtime-band-track">
            <span
              className="activity-runtime-band-fill activity-runtime-band-fill--cpu"
              style={{ width: `${cpuPercent}%` }}
            />
          </div>
        </div>
        <div className="activity-metric-card">
          <span className="activity-metric-label">{t('dashboardMemoryUsage')}</span>
          <strong className="activity-metric-value">{formatBytes(memoryUsedTotal)}</strong>
          <div className="activity-runtime-band-track">
            <span
              className="activity-runtime-band-fill activity-runtime-band-fill--memory"
              style={{ width: `${memoryPercent}%` }}
            />
          </div>
          <div className="activity-rank-meta">
            {memoryLimitTotal > 0 ? `${formatBytes(memoryUsedTotal)} / ${formatBytes(memoryLimitTotal)}` : t('noLimit')}
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel dashboard-panel--wide">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">{t('dashboardStatusMix')}</h3>
            <span className="dashboard-panel-subtitle">{t('activityResultsSummary', { shown: rows.length, total: rows.length })}</span>
          </div>
          <div className="activity-status-meter">
            {statusCounts.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`activity-status-meter-segment activity-status-meter-segment--${item.key}${statusFocus === item.key ? ' activity-status-meter-segment--active' : ''}`}
                style={{ flexGrow: item.count || 0.001 }}
                onClick={() => onStatusFocusChange(statusFocus === item.key ? 'all' : item.key)}
                aria-pressed={statusFocus === item.key}
              />
            ))}
          </div>
          <div className="activity-status-legend">
            {statusCounts.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`activity-status-legend-item${statusFocus === item.key ? ' activity-status-legend-item--active' : ''}`}
                onClick={() => onStatusFocusChange(statusFocus === item.key ? 'all' : item.key)}
                aria-pressed={statusFocus === item.key}
              >
                <span className={`activity-status-legend-dot activity-status-legend-dot--${item.key}`} />
                <span className="activity-status-legend-label">
                  {t(columnLabelKey(item.key) as Parameters<typeof t>[0])}
                </span>
                <strong className="activity-status-legend-value">{compactNumber.format(item.count)}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-panel dashboard-panel--wide">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">{t('dashboardThroughput')}</h3>
            <div className="dashboard-panel-actions">
              <span className="dashboard-panel-subtitle">
                {trendWindow === '24h' ? t('dashboardLast24h') : t('dashboardLast7d')}
              </span>
              <div className="dashboard-toggle" role="group" aria-label={t('dashboardThroughput')}>
                <button
                  type="button"
                  className={`dashboard-toggle-button${trendWindow === '24h' ? ' dashboard-toggle-button--active' : ''}`}
                  onClick={() => {
                    if (trendWindow !== '24h') {
                      setTrendWindow('24h');
                      setThroughputNow(Date.now());
                    }
                  }}
                >
                  {t('timeFilter24h')}
                </button>
                <button
                  type="button"
                  className={`dashboard-toggle-button${trendWindow === '7d' ? ' dashboard-toggle-button--active' : ''}`}
                  onClick={() => {
                    if (trendWindow !== '7d') {
                      setTrendWindow('7d');
                      setThroughputNow(Date.now());
                    }
                  }}
                >
                  {t('timeFilter7d')}
                </button>
              </div>
            </div>
          </div>
          <div className="activity-histogram">
            {throughputBuckets.map((bucket) => (
              <div key={bucket.label} className="activity-histogram-column">
                <span className="activity-histogram-value">{bucket.count > 0 ? bucket.count : ''}</span>
                <div className="activity-histogram-track">
                  <span
                    className="activity-histogram-bar"
                    style={{ height: `${(bucket.count / throughputMax) * 100}%` }}
                  />
                </div>
                <span className="activity-histogram-label">{bucket.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">{t('dashboardRuntimeBands')}</h3>
          </div>
          <div className="activity-runtime-grid">
            {runtimeBuckets.map((bucket) => (
              <div key={bucket.key} className="activity-runtime-band">
                <div className="activity-runtime-band-header">
                  <span className="activity-runtime-band-label">{bucket.label}</span>
                  <strong className="activity-runtime-band-value">{compactNumber.format(bucket.count)}</strong>
                </div>
                <div className="activity-runtime-band-track">
                  <span
                    className={`activity-runtime-band-fill activity-runtime-band-fill--${bucket.key}`}
                    style={{ width: `${(bucket.count / runtimeMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">{t('dashboardHotInstances')}</h3>
          </div>
          {topInstances.length > 0 ? (
            <RankPanel items={topInstances} />
          ) : (
            <div className="dashboard-empty">{t('noActiveSessions')}</div>
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">{t('dashboardModelLoad')}</h3>
          </div>
          {topModels.length > 0 ? (
            <RankPanel items={topModels} />
          ) : (
            <div className="dashboard-empty">{t('noActiveSessions')}</div>
          )}
        </section>
      </div>
    </div>
  );
}
