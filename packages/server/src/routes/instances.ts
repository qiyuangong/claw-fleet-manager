import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';

const execFileAsync = promisify(execFile);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEISHU_CODE_RE = /^[A-Za-z0-9]{3,32}$/;

function parseFeishuPairing(stdout: string): { code: string; userId?: string }[] {
  const results: { code: string; userId?: string }[] = [];
  const headerWords = new Set(['PENDING', 'CODE', 'STATUS', 'USER', 'TIME', 'REQUEST']);
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('=')) continue;
    const codeMatch = trimmed.match(/\b([A-Z0-9]{4,12})\b/);
    const userIdMatch = trimmed.match(/\b(ou_[a-zA-Z0-9_]+)\b/);
    if (codeMatch && !headerWords.has(codeMatch[1])) {
      results.push({ code: codeMatch[1], userId: userIdMatch?.[1] });
    }
  }
  return results;
}

function parsePendingDevices(output: string): { requestId: string; ip: string }[] {
  // Only look at the section before "Paired"
  const pendingSection = output.split(/\nPaired/)[0];
  const devices: { requestId: string; ip: string }[] = [];
  for (const line of pendingSection.split('\n')) {
    const uuidMatch = line.match(/│\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+│/);
    if (!uuidMatch) continue;
    const ipMatch = line.match(/│[^│]*│[^│]*│[^│]*│\s+([\d.]+)\s+│/);
    devices.push({ requestId: uuidMatch[1], ip: ipMatch?.[1] ?? 'unknown' });
  }
  return devices;
}

export async function instanceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/:id/start', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.docker.startContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'START_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/stop', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.docker.stopContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'STOP_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/restart', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.docker.restartContainer(id);
      const status = await app.monitor.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'RESTART_FAILED' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/devices/pending', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec', id, 'node', 'dist/index.js', 'devices', 'list',
      ]);
      return { pending: parsePendingDevices(stdout) };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'DEVICES_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; requestId: string } }>(
    '/api/fleet/:id/devices/:requestId/approve',
    async (request, reply) => {
      const { id, requestId } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!UUID_RE.test(requestId)) {
        return reply.status(400).send({ error: 'Invalid requestId', code: 'INVALID_REQUEST_ID' });
      }
      try {
        await execFileAsync('docker', [
          'exec', id, 'node', 'dist/index.js', 'devices', 'approve', requestId,
        ]);
        return { ok: true };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'APPROVE_FAILED' });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/fleet/:id/feishu/pairing', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      const { stdout } = await execFileAsync('docker', [
        'exec', id, 'node', 'dist/index.js', 'pairing', 'list', 'feishu',
      ]);
      return { pending: parseFeishuPairing(stdout), raw: stdout };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'FEISHU_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; code: string } }>(
    '/api/fleet/:id/feishu/pairing/:code/approve',
    async (request, reply) => {
      const { id, code } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!FEISHU_CODE_RE.test(code)) {
        return reply.status(400).send({ error: 'Invalid pairing code', code: 'INVALID_CODE' });
      }
      try {
        await execFileAsync('docker', [
          'exec', id, 'node', 'dist/index.js', 'pairing', 'approve', 'feishu', code,
        ]);
        return { ok: true };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'FEISHU_APPROVE_FAILED' });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/fleet/:id/token/reveal', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const token = app.fleetConfig.readTokens()[index];
    if (!token) {
      return reply.status(404).send({ error: 'Token not found', code: 'TOKEN_NOT_FOUND' });
    }
    request.log.info({ instance: id }, 'Token revealed');
    return { token };
  });
}
