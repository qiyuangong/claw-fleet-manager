import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateInstanceId } from '../validate.js';

const fleetConfigBodySchema = z.record(z.string(), z.string());
const instanceConfigBodySchema = z.record(z.string(), z.unknown());

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/fleet', async () => app.fleetConfig.readFleetConfig());

  app.put('/api/config/fleet', async (request, reply) => {
    const parsed = fleetConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a Record<string, string>', code: 'INVALID_BODY' });
    }
    app.fleetConfig.writeFleetConfig(parsed.data);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    const index = parseInt(id.replace('openclaw-', ''), 10);
    try {
      return app.fleetConfig.readInstanceConfig(index);
    } catch {
      return reply.status(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/fleet/:id/config', async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    const index = parseInt(id.replace('openclaw-', ''), 10);
    const parsed = instanceConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a JSON object', code: 'INVALID_BODY' });
    }
    try {
      app.fleetConfig.writeInstanceConfig(index, parsed.data);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'CONFIG_WRITE_FAILED' });
    }
  });
}
