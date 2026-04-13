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

const FIXTURE_PREVIEWS = [
  {
    key: 'main',
    status: 'ok',
    items: [
      { role: 'user', text: 'Please fix the flaky test.' },
      { role: 'assistant', text: 'Checking the failure now.' },
      { role: 'tool', text: 'call npm test' },
      { role: 'assistant', text: 'The test now passes.' },
    ],
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

function makeServer(
  opts: { rejectConnect?: boolean; rejectPreviewConnect?: boolean; silentAfterChallenge?: boolean; silentPreview?: boolean } = {},
) {
  const server = new WebSocketServer({ port: PORT });
  server.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'n' } }));
    if (opts.silentAfterChallenge) return;
    ws.on('message', (raw: Buffer) => {
      const frame = JSON.parse(String(raw)) as { method: string; id: string; params?: { scopes?: string[] } };
      if (frame.method === 'connect') {
        if (opts.rejectConnect) {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'AUTH_FAILED', message: 'bad token' } }));
          return;
        }
        if (opts.rejectPreviewConnect && frame.params?.scopes?.includes('operator.admin')) {
          ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'AUTH_FAILED', message: 'missing scope: operator.admin' } }));
          return;
        }
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: {} }));
      }
      if (frame.method === 'sessions.list') {
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { sessions: FIXTURE_SESSIONS } }));
      }
      if (frame.method === 'sessions.preview') {
        if (opts.silentPreview) return;
        ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { previews: FIXTURE_PREVIEWS } }));
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
        if (frame.method === 'sessions.preview') ws.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload: { previews: [] } }));
      });
    });
    const sessions = await fetchInstanceSessions(PORT, 'valid-token');
    expect(sessions).toEqual([]);
  });

  it('filters by status and merges bounded preview items when requested', async () => {
    wss = makeServer();
    const sessions = await fetchInstanceSessions(PORT, 'valid-token', 5_000, { status: 'running', previewLimit: 2 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].previewItems).toEqual([
      { role: 'tool', text: 'call npm test' },
      { role: 'assistant', text: 'The test now passes.' },
    ]);
  });

  it('falls back to last-message sessions when preview connect needs admin scope', async () => {
    wss = makeServer({ rejectPreviewConnect: true });
    const sessions = await fetchInstanceSessions(PORT, 'valid-token', 5_000, { status: 'running', previewLimit: 2 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].lastMessagePreview).toBe('The test now passes.');
    expect(sessions[0].previewItems).toBeUndefined();
  });

  it('falls back to last-message sessions when preview request times out', async () => {
    wss = makeServer({ silentPreview: true });
    const sessions = await fetchInstanceSessions(PORT, 'valid-token', 300, { status: 'running', previewLimit: 2 });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].lastMessagePreview).toBe('The test now passes.');
    expect(sessions[0].previewItems).toBeUndefined();
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
