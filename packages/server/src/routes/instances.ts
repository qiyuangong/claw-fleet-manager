import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';

const execFileAsync = promisify(execFile);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

  app.post<{ Params: { id: string } }>('/api/fleet/:id/token/reveal', async (request, reply) => {
    const { id } = request.params;
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const token = app.fleetConfig.readTokens()[index];
    if (!token) {
      return reply.status(404).send({ error: 'Token not found', code: 'TOKEN_NOT_FOUND' });
    }
    request.log.info({ instance: id }, 'Token revealed');
    return { token };
  });
}
