import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { safeError } from '../errors.js';
import { errorResponseSchema, fleetInstanceSchema, instanceIdParamsSchema } from '../schemas.js';
import { validateInstanceId } from '../validate.js';
import type { HybridBackend, MigrateOpts } from '../services/hybrid-backend.js';

const migrateBodySchema = z.object({
  targetMode: z.enum(['docker', 'profile']),
  deleteSource: z.boolean().optional(),
});

export async function migrateRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/instances/:id/migrate', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Instances'],
      summary: 'Migrate an instance between docker and profile modes',
      params: instanceIdParamsSchema,
      body: {
        type: 'object',
        properties: {
          targetMode: { type: 'string', enum: ['docker', 'profile'] },
          deleteSource: { type: 'boolean' },
        },
        required: ['targetMode'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (app.deploymentMode !== 'hybrid') {
      return reply.status(400).send({
        error: 'Migration is only available in hybrid deployment mode',
        code: 'MODE_UNAVAILABLE',
      });
    }

    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }

    const parsed = migrateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }

    const opts: MigrateOpts = {
      targetMode: parsed.data.targetMode,
      deleteSource: parsed.data.deleteSource ?? false,
    };

    try {
      return await (app.backend as HybridBackend).migrate(id, opts);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: safeError(error), code: 'INSTANCE_NOT_FOUND' });
      }
      if (message.includes('already in')) {
        return reply.status(400).send({ error: safeError(error), code: 'ALREADY_TARGET_MODE' });
      }
      return reply.status(500).send({ error: safeError(error), code: 'MIGRATE_FAILED' });
    }
  });
}
