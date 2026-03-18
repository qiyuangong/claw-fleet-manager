import type { FastifyInstance } from 'fastify';

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
