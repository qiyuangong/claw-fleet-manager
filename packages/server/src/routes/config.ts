import type { FastifyInstance } from 'fastify';

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/fleet', async () => app.fleetConfig.readFleetConfig());

  app.put('/api/config/fleet', async (request) => {
    app.fleetConfig.writeFleetConfig(request.body as Record<string, string>);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const index = parseInt(request.params.id.replace('openclaw-', ''), 10);
    try {
      return app.fleetConfig.readInstanceConfig(index);
    } catch {
      return reply.status(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const index = parseInt(request.params.id.replace('openclaw-', ''), 10);
    try {
      app.fleetConfig.writeInstanceConfig(index, request.body);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'CONFIG_WRITE_FAILED' });
    }
  });
}
