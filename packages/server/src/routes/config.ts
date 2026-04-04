// packages/server/src/routes/config.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateInstanceId } from '../validate.js';
import { requireAdmin, requireProfileAccess } from '../authorize.js';
import { errorResponseSchema, fleetConfigSchema, instanceIdParamsSchema, okResponseSchema } from '../schemas.js';

const fleetConfigBodySchema = z.record(z.string(), z.string());
const instanceConfigBodySchema = z.record(z.string(), z.unknown());

export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config/fleet', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Config'],
      summary: 'Read fleet-level configuration',
      response: {
        200: fleetConfigSchema,
      },
    },
  }, async () => {
    const cached = app.backend.getCachedStatus();
    const liveCount = cached?.instances.filter((instance) => instance.mode === 'docker').length;
    return app.fleetConfig.readFleetConfig(liveCount);
  });

  app.put('/api/config/fleet', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Config'],
      summary: 'Write fleet-level configuration',
      body: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = fleetConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a Record<string, string>', code: 'INVALID_BODY' });
    }

    const { BASE_DIR, ...vars } = parsed.data;
    const currentConfig = app.fleetConfig.readFleetConfig();

    if (BASE_DIR !== undefined && BASE_DIR !== currentConfig.baseDir) {
      const cachedStatus = app.backend.getCachedStatus();
      let status = cachedStatus;
      if (!status) {
        try {
          status = await app.backend.refresh();
        } catch {
          return reply.status(409).send({
            error: 'Base directory cannot be changed while Docker instance state cannot be verified',
            code: 'BASE_DIR_UNVERIFIED',
          });
        }
      }
      const hasDockerInstances = status?.instances.some((instance) => instance.mode === 'docker') ?? false;
      if (hasDockerInstances) {
        return reply.status(409).send({
          error: 'Base directory can only be changed before Docker instances are created',
          code: 'BASE_DIR_IN_USE',
        });
      }

      try {
        app.fleetConfig.updateBaseDir(BASE_DIR, { applyImmediately: true });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message, code: 'INVALID_BASE_DIR' });
      }
    }

    const currentVars = app.fleetConfig.readFleetEnvRaw();
    app.fleetConfig.writeFleetConfig({
      ...currentVars,
      ...vars,
    });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/config', {
    preHandler: requireProfileAccess,
    schema: {
      tags: ['Config'],
      summary: 'Read per-instance configuration',
      params: instanceIdParamsSchema,
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      return await app.backend.readInstanceConfig(id);
    } catch {
      return reply.status(404).send({ error: 'Config not found', code: 'CONFIG_NOT_FOUND' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/fleet/:id/config', {
    preHandler: requireProfileAccess,
    schema: {
      tags: ['Config'],
      summary: 'Write per-instance configuration',
      params: instanceIdParamsSchema,
      body: {
        type: 'object',
        additionalProperties: true,
      },
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    const parsed = instanceConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Body must be a JSON object', code: 'INVALID_BODY' });
    }
    try {
      await app.backend.writeInstanceConfig(id, parsed.data as object);
      return { ok: true };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'CONFIG_WRITE_FAILED' });
    }
  });
}
