import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
};

type ResFrame = { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { code: string; message: string } };
type EventFrame = { type: 'event'; event: string; payload?: unknown };

export async function fetchInstanceSessions(
  port: number,
  token: string,
  timeoutMs = 5_000,
): Promise<InstanceSessionRow[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let settled = false;

    const timer = setTimeout(() => {
      done(null, new Error(`openclaw on port ${port} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    function done(sessions: InstanceSessionRow[] | null, err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.terminate();
      if (err) reject(err);
      else resolve(sessions ?? []);
    }

    function request<T>(method: string, params: unknown): Promise<T> {
      return new Promise<T>((res, rej) => {
        const id = randomUUID();
        pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      });
    }

    ws.on('error', (err) => done(null, err));

    ws.on('message', (raw) => {
      let frame: ResFrame | EventFrame;
      try {
        frame = JSON.parse(String(raw)) as ResFrame | EventFrame;
      } catch {
        return;
      }

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        void (async () => {
          try {
            await request('connect', {
              minProtocol: 3,
              maxProtocol: 3,
              role: 'operator',
              scopes: ['operator.read'],
              auth: { token },
            });
            const result = await request<{ sessions?: InstanceSessionRow[] }>(
              'sessions.list',
              { activeMinutes: 60 },
            );
            done(result?.sessions ?? []);
          } catch (err) {
            done(null, err instanceof Error ? err : new Error(String(err)));
          }
        })();
        return;
      }

      if (frame.type === 'res') {
        const p = pending.get(frame.id);
        if (!p) return;
        pending.delete(frame.id);
        if (frame.ok) p.resolve(frame.payload);
        else p.reject(new Error(frame.error?.message ?? 'gateway request failed'));
      }
    });
  });
}
