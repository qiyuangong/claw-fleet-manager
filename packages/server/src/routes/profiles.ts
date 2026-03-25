// packages/server/src/routes/profiles.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const createProfileSchema = z.object({
  name: z.string().regex(PROFILE_NAME_RE, 'name must be lowercase alphanumeric with hyphens'),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/fleet/profiles', async () => {
    const status = app.backend.getCachedStatus();
    return { instances: status?.instances ?? [], mode: 'profiles' };
  });

  app.post('/api/fleet/profiles', async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }
    try {
      const { name, port, config } = parsed.data;
      const instance = await app.backend.createInstance({ name, port, config: config as object | undefined });
      return instance;
    } catch (error: any) {
      const code = error.message?.includes('already exists') ? 409
        : error.message?.includes('in use') ? 409 : 500;
      return reply.status(code).send({ error: error.message, code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { name: string } }>('/api/fleet/profiles/:name', async (request, reply) => {
    const { name } = request.params;
    if (!PROFILE_NAME_RE.test(name)) {
      return reply.status(400).send({ error: 'Invalid profile name', code: 'INVALID_NAME' });
    }
    try {
      await app.backend.removeInstance(name);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'REMOVE_FAILED' });
    }
  });
}
