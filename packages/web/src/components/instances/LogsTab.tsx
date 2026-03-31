import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogs } from '../../hooks/useLogs';

export function LogsTab({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const { lines, connected, reconnectFailed, resetAndReconnect, clear } = useLogs(instanceId);
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
        <span className="pill">{connected ? t('connected') : t('disconnected')}</span>
        <input
          className="text-input"
          placeholder={t('filterLogs')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button className="secondary-button" onClick={clear}>{t('clear')}</button>
        <button className="secondary-button" onClick={download}>{t('download')}</button>
        <label className="pill">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          {t('autoScroll')}
        </label>
      </div>

      {reconnectFailed && (
        <div className="ws-reconnect-failed-banner">
          <span>{t('logStreamingFailed')}</span>
          <button className="secondary-button" onClick={resetAndReconnect}>{t('reload')}</button>
        </div>
      )}

      <div ref={containerRef} className="log-viewer">
        {filtered.length === 0 ? t('waitingForLogs') : null}
        {filtered.map((entry, index) => (
          <div key={`${entry.ts}-${index}`}>{entry.line}</div>
        ))}
      </div>
    </div>
  );
}
