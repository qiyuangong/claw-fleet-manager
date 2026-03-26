// packages/server/src/routes/logs.ts
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';
import { requireAdmin, requireProfileAccess } from '../authorize.js';

export async function logRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/logs/:id',
    { websocket: true, preHandler: requireProfileAccess },
    async (socket: any, request) => {
      const { id } = request.params;

      if (!validateInstanceId(id, app.deploymentMode)) {
        socket.send(JSON.stringify({ error: 'Invalid instance id' }));
        socket.close();
        return;
      }

      const handle = app.backend.streamLogs(id, (line) => {
        socket.send(JSON.stringify({ id, line, ts: Date.now() }));
      });

      socket.on('close', () => handle.stop());
    },
  );

  app.get('/ws/logs', { websocket: true, preHandler: requireAdmin }, async (socket: any) => {
    const handle = app.backend.streamAllLogs((id, line) => {
      socket.send(JSON.stringify({ id, line, ts: Date.now() }));
    });

    socket.on('close', () => handle.stop());
  });
}
