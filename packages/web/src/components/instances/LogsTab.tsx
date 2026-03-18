import { useEffect, useRef, useState } from 'react';
import { useLogs } from '../../hooks/useLogs';

export function LogsTab({ instanceId }: { instanceId: string }) {
  const { lines, connected, clear } = useLogs(instanceId);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll, lines]);

  const filtered = filter
    ? lines.filter((line) => line.line.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const download = () => {
    const blob = new Blob([filtered.map((line) => line.line).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${instanceId}-logs.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel-card log-shell">
      <div className="toolbar-row">
        <span className="pill">{connected ? 'Connected' : 'Disconnected'}</span>
        <input
          className="text-input"
          placeholder="Filter logs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button className="secondary-button" onClick={clear}>Clear</button>
        <button className="secondary-button" onClick={download}>Download</button>
        <label className="pill">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          Auto-scroll
        </label>
      </div>

      <div ref={containerRef} className="log-viewer">
        {filtered.length === 0 ? 'Waiting for logs...' : null}
        {filtered.map((entry, index) => (
          <div key={`${entry.ts}-${index}`}>{entry.line}</div>
        ))}
      </div>
    </div>
  );
}
