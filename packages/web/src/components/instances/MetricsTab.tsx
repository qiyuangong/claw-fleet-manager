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

interface SeriesChartProps {
  color: string;
  domainMax: number;
  emptyValueLabel: string;
  formatter?: (value: number) => string;
  points: DataPoint[];
  valueKey: 'cpu' | 'memory';
}

const MAX_POINTS = 120;
const MAX_CACHED_INSTANCES = 24;
const CHART_HEIGHT = 220;
const CHART_WIDTH = 520;
const PADDING_X = 18;
const PADDING_Y = 18;
const historyByInstance = new Map<string, HistoryCacheEntry>();

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

function formatMegabytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  return `${value.toFixed(1)} MB`;
}

function sanitizeNumber(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function pointLabel(value: number, formatter?: (value: number) => string) {
  if (formatter) return formatter(value);
  return `${value.toFixed(1)}`;
}

function SeriesChart({
  color,
  domainMax,
  emptyValueLabel,
  formatter,
  points,
  valueKey,
}: SeriesChartProps) {
  const chartWidth = CHART_WIDTH - PADDING_X * 2;
  const chartHeight = CHART_HEIGHT - PADDING_Y * 2;
  const maxValue = Math.max(domainMax, ...points.map((point) => point[valueKey]));
  const safeMaxValue = maxValue > 0 ? maxValue : 1;
  const coordinates = points.map((point, index) => {
    const x = PADDING_X + (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
    const y = PADDING_Y + chartHeight - (point[valueKey] / safeMaxValue) * chartHeight;
    return { x, y };
  });
  const polylinePoints = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
  const latestPoint = points.at(-1);
  const latestCoordinate = coordinates.at(-1);
  const latestValue = latestPoint ? pointLabel(latestPoint[valueKey], formatter) : emptyValueLabel;

  return (
    <div className="chart-shell" style={{ height: `${CHART_HEIGHT}px` }}>
      <svg
        aria-label={`${valueKey}-history-chart`}
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <line
          x1={PADDING_X}
          x2={PADDING_X}
          y1={PADDING_Y}
          y2={PADDING_Y + chartHeight}
          stroke="#274066"
          strokeWidth="1"
        />
        <line
          x1={PADDING_X}
          x2={PADDING_X + chartWidth}
          y1={PADDING_Y + chartHeight}
          y2={PADDING_Y + chartHeight}
          stroke="#274066"
          strokeWidth="1"
        />
        {coordinates.length > 1 ? (
          <polyline
            fill="none"
            points={polylinePoints}
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        ) : null}
        {latestCoordinate ? (
          <circle cx={latestCoordinate.x} cy={latestCoordinate.y} fill={color} r="4" />
        ) : null}
        <text fill="#94a5c6" fontSize="11" x={PADDING_X} y={PADDING_Y - 4}>
          {pointLabel(safeMaxValue, formatter)}
        </text>
        <text fill="#94a5c6" fontSize="11" x={PADDING_X} y={PADDING_Y + chartHeight - 4}>
          {emptyValueLabel}
        </text>
        {latestPoint ? (
          <>
            <text fill={color} fontSize="12" fontWeight="600" x={CHART_WIDTH - PADDING_X} y={PADDING_Y - 4} textAnchor="end">
              {latestValue}
            </text>
            <text fill="#94a5c6" fontSize="11" x={CHART_WIDTH - PADDING_X} y={CHART_HEIGHT - 4} textAnchor="end">
              {latestPoint.time}
            </text>
          </>
        ) : null}
      </svg>
    </div>
  );
}

export function MetricsTab({ instance }: { instance: FleetInstance }) {
  const { t } = useTranslation();
  const history = getHistory(instance);

  return (
    <div className="field-grid">
      <section className="panel-card">
        <h3 style={{ marginTop: 0 }}>{t('cpuHistory')}</h3>
        <SeriesChart
          color="#7be0ff"
          domainMax={100}
          emptyValueLabel="0%"
          formatter={(value) => `${value.toFixed(1)}%`}
          points={history}
          valueKey="cpu"
        />
      </section>

      <section className="panel-card">
        <h3 style={{ marginTop: 0 }}>{t('memoryHistory')}</h3>
        <SeriesChart
          color="#ffcb70"
          domainMax={0}
          emptyValueLabel="0 MB"
          formatter={formatMegabytes}
          points={history}
          valueKey="memory"
        />
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
  const cpu = Math.max(0, Math.min(sanitizeNumber(instance.cpu), 100));
  const memoryUsed = Math.max(0, sanitizeNumber(instance.memory.used));
  const sampleKey = `${cpu}:${memoryUsed}`;
  const cached = historyByInstance.get(instance.id);
  if (cached?.sampleKey === sampleKey) {
    cached.lastUpdatedAt = Date.now();
    return cached.points;
  }

  const point: DataPoint = {
    time: new Date().toLocaleTimeString(),
    cpu,
    memory: memoryUsed / (1024 * 1024),
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
