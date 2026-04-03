import { useEffect, useReducer, useRef } from 'react';
import { getApiClientAuthToken } from '../api/client';

interface LogEntry {
  id: string;
  line: string;
  ts: number;
}

const MAX_LINES = 1000;
type LogsState = {
  lines: LogEntry[];
  connected: boolean;
  reconnectFailed: boolean;
};

type LogsAction =
  | { type: 'resetConnection' }
  | { type: 'connected' }
  | { type: 'disconnected' }
  | { type: 'append'; entry: LogEntry }
  | { type: 'reconnectFailed' }
  | { type: 'clear' };

const initialState: LogsState = {
  lines: [],
  connected: false,
  reconnectFailed: false,
};

function logsReducer(state: LogsState, action: LogsAction): LogsState {
  switch (action.type) {
    case 'resetConnection':
      return { ...state, connected: false, reconnectFailed: false };
    case 'connected':
      return { ...state, connected: true, reconnectFailed: false };
    case 'disconnected':
      return { ...state, connected: false };
    case 'append': {
      const next = [...state.lines, action.entry];
      return {
        ...state,
        lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next,
      };
    }
    case 'reconnectFailed':
      return { ...state, reconnectFailed: true };
    case 'clear':
      return { ...state, lines: [] };
    default:
      return state;
  }
}

function wsAuthQuery(): string {
  const token = getApiClientAuthToken();
  if (!token) return '';
  return `?auth=${encodeURIComponent(token)}`;
}

const MAX_RETRIES = 3;

export function useLogs(instanceId: string | null) {
  const [state, dispatch] = useReducer(logsReducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!instanceId) return undefined;

    let cancelled = false;
    retryRef.current = 0;
    dispatch({ type: 'resetConnection' });

    const connect = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const query = wsAuthQuery();
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/logs/${instanceId}${query}`);
      wsRef.current = socket;

      socket.onopen = () => {
        dispatch({ type: 'connected' });
        retryRef.current = 0;
      };

      socket.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data) as LogEntry;
          dispatch({ type: 'append', entry });
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        dispatch({ type: 'disconnected' });
        if (cancelled) return;
        if (retryRef.current >= MAX_RETRIES) {
          dispatch({ type: 'reconnectFailed' });
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
    dispatch({ type: 'resetConnection' });
    connectRef.current?.();
  };

  return {
    lines: state.lines,
    connected: state.connected,
    reconnectFailed: state.reconnectFailed,
    resetAndReconnect,
    clear: () => dispatch({ type: 'clear' }),
  };
}
