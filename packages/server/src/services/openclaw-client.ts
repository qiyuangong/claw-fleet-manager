import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import { getOpenClawHttpOrigin, getOpenClawWsUrl } from './openclaw-upstream.js';

export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  previewItems?: InstanceSessionPreviewItem[];
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
};

export type InstanceSessionPreviewItem = {
  role: string;
  text: string;
};

type SessionPreviewResponse = {
  key: string;
  status?: string;
  items?: InstanceSessionPreviewItem[];
};

type FetchInstanceSessionsOptions = {
  status?: InstanceSessionRow['status'];
  previewLimit?: number;
  activeMinutes?: number;
};

type ResFrame = { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { code: string; message: string } };
type EventFrame = { type: 'event'; event: string; payload?: unknown };

function normalizePreviewItems(items: InstanceSessionPreviewItem[] | undefined, previewLimit: number): InstanceSessionPreviewItem[] {
  if (!items?.length || previewLimit <= 0) return [];
  return items
    .filter((item) => item?.text?.trim())
    .slice(-previewLimit);
}

function previewRequestTimeout(timeoutMs: number): number {
  return Math.max(100, Math.min(1_500, Math.floor(timeoutMs / 2)));
}

async function fetchSessionPreviews(
  port: number,
  token: string,
  sessionKeys: string[],
  timeoutMs: number,
  previewLimit: number,
): Promise<Map<string, InstanceSessionPreviewItem[]>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(getOpenClawWsUrl(port), {
      headers: { Origin: getOpenClawHttpOrigin(port) },
    });
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let settled = false;

    const timer = setTimeout(() => {
      done(null, new Error(`openclaw preview on port ${port} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    function done(previews: Map<string, InstanceSessionPreviewItem[]> | null, err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const drainError = err ?? new Error('connection closed before preview response');
      for (const p of pending.values()) p.reject(drainError);
      pending.clear();
      ws.terminate();
      if (err) reject(err);
      else resolve(previews ?? new Map());
    }

    function request<T>(method: string, params: unknown): Promise<T> {
      return new Promise<T>((res, rej) => {
        const id = randomUUID();
        pending.set(id, { resolve: res as (v: unknown) => void, reject: rej });
        ws.send(JSON.stringify({ type: 'req', id, method, params }));
      });
    }

    ws.on('error', (err) => done(null, err));
    ws.on('close', () => done(null, new Error(`openclaw on port ${port} closed preview connection before responding`)));

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
              client: {
                id: 'openclaw-control-ui',
                version: '1.0.0',
                platform: 'node',
                mode: 'ui',
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.admin'],
              auth: { token },
            });
            const previewResult = await request<{ previews?: SessionPreviewResponse[] }>(
              'sessions.preview',
              { keys: sessionKeys },
            );
            const previewsByKey = new Map(
              (previewResult?.previews ?? [])
                .map((preview) => [preview.key, normalizePreviewItems(preview.items, previewLimit)] as const)
                .filter((entry) => entry[1].length > 0),
            );
            done(previewsByKey);
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

export async function fetchInstanceSessions(
  port: number,
  token: string,
  timeoutMs = 5_000,
  options?: FetchInstanceSessionsOptions,
): Promise<InstanceSessionRow[]> {
  return new Promise((resolve, reject) => {
    // Origin must match gateway.controlUi.allowedOrigins for control-ui client auth
    const ws = new WebSocket(getOpenClawWsUrl(port), {
      headers: { Origin: getOpenClawHttpOrigin(port) },
    });
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let settled = false;

    const timer = setTimeout(() => {
      done(null, new Error(`openclaw on port ${port} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    function done(sessions: InstanceSessionRow[] | null, err?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Drain pending requests so their promises don't silently leak
      const drainError = err ?? new Error('connection closed before response');
      for (const p of pending.values()) p.reject(drainError);
      pending.clear();
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
    ws.on('close', () => done(null, new Error(`openclaw on port ${port} closed connection before responding`)));

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
            const previewLimit = Math.max(0, Math.min(Math.trunc(options?.previewLimit ?? 0), 8));
            await request('connect', {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'openclaw-control-ui',
                version: '1.0.0',
                platform: 'node',
                mode: 'ui',
              },
              role: 'operator',
              scopes: ['operator.read'],
              auth: { token },
            });
            // sessions active within the last hour
            const result = await request<{ sessions?: InstanceSessionRow[] }>(
              'sessions.list',
              {
                activeMinutes: options?.activeMinutes ?? 60,
                includeDerivedTitles: true,
                includeLastMessage: true,
              },
            );
            let sessions = result?.sessions ?? [];

            if (options?.status) {
              sessions = sessions.filter((session) => session.status === options.status);
            }

            if (previewLimit > 0 && sessions.length > 0) {
              clearTimeout(timer);
              try {
                const previewsByKey = await fetchSessionPreviews(
                  port,
                  token,
                  sessions.map((session) => session.key),
                  previewRequestTimeout(timeoutMs),
                  previewLimit,
                );
                sessions = sessions.map((session) => {
                  const previewItems = previewsByKey.get(session.key);
                  return previewItems ? { ...session, previewItems } : session;
                });
              } catch {
                // Preview hydration is best-effort. Fall back to lastMessagePreview only.
              }
            }

            done(sessions);
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
