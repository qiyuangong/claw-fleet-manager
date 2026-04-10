import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { fetchInstanceSessions } from '../../src/services/openclaw-client.js';
import type { InstanceSessionRow } from '../../src/services/openclaw-client.js';

const FIXTURE_SESSIONS: InstanceSessionRow[] = [
  {
    key: 'main',
    derivedTitle: 'Fix CI flake',
    status: 'running',
    startedAt: Date.now() - 60_000,
    model: 'claude-opus-4',
    lastMessagePreview: 'The test now passes.',
  },
];

const PORT = 19_999;
let wss: WebSocketServer | undefined;

afterEach(
  () =>
    new Promise<void>((res) => {
      if (!wss) { res(); return; }
      wss.close(() => res());
      wss = undefined;
    }),
);

function makeServer(opts: { rejectConnect?: boolean; silentAfterChallenge?: boolean } = {}) {
  const server = new WebSocketServer({ port: PORT });
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n' } }));
    if (opts.silentAfterChallenge) return;
    ws.on('message', (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as { method: string; id: string };
      if (frame.method === 'connect') {
        if (opts.rejectConnect) {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'AUTH_FAILED', message: 'bad token' } }));
          return;
        }
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
      }
      if (frame.method === 'sessions.list') {
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { sessions: FIXTURE_SESSIONS } }));
      }
    });
  });
  return server;
}

describe('fetchInstanceSessions', () => {
  it('returns sessions from a healthy instance', async () => {
    wss = makeServer();
    const sessions = await fetchInstanceSessions(PORT, 'valid-token');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].derivedTitle).toBe('Fix CI flake');
    expect(sessions[0].status).toBe('running');
  });

  it('returns empty array when payload has no sessions field', async () => {
    wss = new WebSocketServer({ port: PORT });
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge' }));
      ws.on('message', (raw: Buffer) => {
        const frame = JSON.parse(String(raw)) as { method: string; id: string };
        if (frame.method === 'connect') ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
        if (frame.method === 'sessions.list') ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
      });
    });
    const sessions = await fetchInstanceSessions(PORT, 'valid-token');
    expect(sessions).toEqual([]);
  });

  it('rejects when connect is refused', async () => {
    wss = makeServer({ rejectConnect: true });
    await expect(fetchInstanceSessions(PORT, 'bad-token')).rejects.toThrow('bad token');
  });

  it('rejects on timeout', async () => {
    wss = makeServer({ silentAfterChallenge: true });
    await expect(fetchInstanceSessions(PORT, 'any', 300)).rejects.toThrow('did not respond');
  });

  it('rejects when nothing is listening on the port', async () => {
    // wss stays undefined, afterEach handles it safely
    await expect(fetchInstanceSessions(PORT, 'any', 300)).rejects.toThrow();
  });
});
