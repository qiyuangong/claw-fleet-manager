import { useEffect, useRef, useState } from 'react';
import { getApiClientAuthToken } from '../api/client';

interface LogEntry {
  id: string;
  line: string;
  ts: number;
}

const MAX_LINES = 1000;

function wsAuthQuery(): string {
  const token = getApiClientAuthToken();
  if (!token) return '';
  return `?auth=${encodeURIComponent(token)}`;
}

const MAX_RETRIES = 3;

export function useLogs(instanceId: string | null) {
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!instanceId) return undefined;

    let cancelled = false;
    retryRef.current = 0;
    setReconnectFailed(false);

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const query = wsAuthQuery();
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/logs/${instanceId}${query}`);
      wsRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
        setReconnectFailed(false);
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
        if (cancelled) return;
        if (retryRef.current >= MAX_RETRIES) {
          setReconnectFailed(true);
          return;
        }
        retryRef.current += 1;
        window.setTimeout(connect, 1000 * retryRef.current);
      };

      socket.onerror = () => socket.close();
    };

    connectRef.current = connect;
    connect();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      wsRef.current = null;
      connectRef.current = null;
    };
  }, [instanceId]);

  const resetAndReconnect = () => {
    wsRef.current?.close();
    wsRef.current = null;
    retryRef.current = 0;
    setReconnectFailed(false);
    setConnected(false);
    connectRef.current?.();
  };

  return {
    lines,
    connected,
    reconnectFailed,
    resetAndReconnect,
    clear: () => setLines([]),
  };
}
