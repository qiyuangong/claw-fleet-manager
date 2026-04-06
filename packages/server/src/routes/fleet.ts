// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { safeError } from '../errors.js';
import { getManagedProfileNameError, isValidManagedProfileName } from '../profile-names.js';
import { errorResponseSchema, fleetInstanceSchema, fleetStatusSchema, instanceIdParamsSchema, okResponseSchema } from '../schemas.js';
import { MANAGED_INSTANCE_ID_RE, validateInstanceId } from '../validate.js';

const scaleSchema = z.object({ count: z.number().int().positive() });
const createInstanceSchema = z.object({
  kind: z.enum(['docker', 'profile']),
  name: z.string().min(1),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().min(1).optional(),
  image: z.string().min(1).optional(),
  cpuLimit: z.string().min(1).optional(),
  memoryLimit: z.string().min(1).optional(),
  portStep: z.number().int().positive().optional(),
  enableNpmPackages: z.boolean().optional(),
});
let scaling = false;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', {
    schema: {
      tags: ['Fleet'],
      summary: 'Get current fleet status',
      response: {
        200: fleetStatusSchema,
      },
    },
  }, async (request) => {
    const status = app.backend.getCachedStatus()
      ?? { instances: [], totalRunning: 0, updatedAt: Date.now() };
    if (!request.user || request.user.role === 'admin') return status;
    // Filter instances to assigned profiles only for non-admin users
    const assigned = new Set(request.user.assignedProfiles);
    return {
      ...status,
      instances: status.instances.filter((i) => assigned.has(i.id)),
      totalRunning: status.instances.filter((i) => assigned.has(i.id) && i.status === 'running').length,
    };
  });

  app.post('/api/fleet/scale', {
    preHandler: requireAdmin,
    attachValidation: true,
    schema: {
      tags: ['Fleet'],
      summary: 'Scale fleet to the requested instance count',
      body: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1 },
        },
        required: ['count'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            fleet: fleetStatusSchema,
          },
          required: ['ok', 'fleet'],
        },
        400: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (request.validationError) {
      return reply.status(400).send({ error: 'count must be a positive integer', code: 'INVALID_COUNT' });
    }
    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'count must be a positive integer', code: 'INVALID_COUNT' });
    }

    if (scaling) {
      return reply.status(409).send({ error: 'Scale operation already in progress', code: 'SCALE_IN_PROGRESS' });
    }
    scaling = true;

    try {
      const { count } = parsed.data;
      const fleetStatus = await app.backend.scaleFleet(count, app.fleetDir);
      return { ok: true, fleet: fleetStatus };
    } catch (error: unknown) {
      return reply.status(500).send({ error: safeError(error), code: 'SCALE_FAILED' });
    } finally {
      scaling = false;
    }
  });

  app.post('/api/fleet/instances', {
    preHandler: requireAdmin,
    attachValidation: true,
    schema: {
      tags: ['Fleet'],
      summary: 'Create a new fleet instance',
      body: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['docker', 'profile'] },
          name: { type: 'string', minLength: 1 },
          port: { type: 'integer', minimum: 1 },
          config: { type: 'object', additionalProperties: true },
          apiKey: { type: 'string', minLength: 1 },
          image: { type: 'string', minLength: 1 },
          cpuLimit: { type: 'string', minLength: 1 },
          memoryLimit: { type: 'string', minLength: 1 },
          portStep: { type: 'integer', minimum: 1 },
          enableNpmPackages: { type: 'boolean' },
        },
        required: ['kind', 'name'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (request.validationError) {
      return reply.status(400).send({
        error: request.validationError.message,
        code: 'INVALID_BODY',
      });
    }
    const parsed = createInstanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }

    const { kind, name, port, config, apiKey, image, cpuLimit, memoryLimit, portStep, enableNpmPackages } = parsed.data;
    if (kind === 'profile') {
      if (!isValidManagedProfileName(name)) {
        return reply.status(400).send({
          error: getManagedProfileNameError(name),
          code: 'INVALID_NAME',
        });
      }
    } else if (!MANAGED_INSTANCE_ID_RE.test(name)) {
      return reply.status(400).send({
        error: 'name must be lowercase alphanumeric with hyphens',
        code: 'INVALID_NAME',
      });
    }

    try {
      const instance = await app.backend.createInstance({
        kind,
        name,
        port,
        config: config as object | undefined,
        apiKey,
        image,
        cpuLimit,
        memoryLimit,
        portStep,
        enableNpmPackages,
      });
      return instance;
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const statusCode = rawMessage.includes('already exists') || rawMessage.includes('in use') ? 409 : 500;
      return reply.status(statusCode).send({ error: safeError(error), code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/fleet/instances/:id', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Fleet'],
      summary: 'Remove a fleet instance',
      params: instanceIdParamsSchema,
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

    try {
      await app.backend.removeInstance(id);
      return { ok: true };
    } catch (error: unknown) {
      return reply.status(500).send({ error: safeError(error), code: 'REMOVE_FAILED' });
    }
  });
}
