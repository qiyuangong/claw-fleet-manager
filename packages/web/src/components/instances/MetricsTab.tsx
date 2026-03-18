import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEffect, useState } from 'react';
import type { FleetInstance } from '../../types';

interface DataPoint {
  time: string;
  cpu: number;
  memory: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(1)} ${units[index]}`;
}

export function MetricsTab({ instance }: { instance: FleetInstance }) {
  const [history, setHistory] = useState<DataPoint[]>([]);

  useEffect(() => {
    const point: DataPoint = {
      time: new Date().toLocaleTimeString(),
      cpu: instance.cpu,
      memory: instance.memory.used / (1024 * 1024),
    };

    setHistory((prev) => {
      const next = [...prev, point];
      return next.length > 120 ? next.slice(-120) : next;
    });
  }, [instance.cpu, instance.memory.used]);

  return (
    <div className="field-grid">
      <section className="panel-card">
        <h3 style={{ marginTop: 0 }}>CPU History</h3>
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
        <h3 style={{ marginTop: 0 }}>Memory History</h3>
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
          <p className="metric-label">Config Volume</p>
          <p className="metric-value mono">{formatBytes(instance.disk.config)}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Workspace Volume</p>
          <p className="metric-value mono">{formatBytes(instance.disk.workspace)}</p>
        </div>
      </section>
    </div>
  );
}
