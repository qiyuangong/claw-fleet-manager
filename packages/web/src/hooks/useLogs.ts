import { useEffect, useRef, useState } from 'react';

interface LogEntry {
  id: string;
  line: string;
  ts: number;
}

const MAX_LINES = 1000;

function wsAuthQuery(): string {
  const username = import.meta.env.VITE_BASIC_AUTH_USER;
  const password = import.meta.env.VITE_BASIC_AUTH_PASSWORD;
  if (!username || !password) return '';
  const token = btoa(`${username}:${password}`);
  return `?auth=${encodeURIComponent(token)}`;
}

export function useLogs(instanceId: string | null) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);

  useEffect(() => {
    if (!instanceId) return undefined;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const query = wsAuthQuery();
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/logs/${instanceId}${query}`);
      wsRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        retryRef.current = 0;
      };

      socket.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data) as LogEntry;
          setLines((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (cancelled || retryRef.current >= 3) return;
        retryRef.current += 1;
        window.setTimeout(connect, 1000 * retryRef.current);
      };

      socket.onerror = () => socket.close();
    };

    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [instanceId]);

  return {
    lines,
    connected,
    clear: () => setLines([]),
  };
}
