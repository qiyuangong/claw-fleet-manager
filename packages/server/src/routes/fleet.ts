// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { safeError } from '../errors.js';
import { getManagedProfileNameError, isValidManagedProfileName } from '../profile-names.js';
import { errorResponseSchema, fleetInstanceSchema, fleetStatusSchema, instanceIdParamsSchema, okResponseSchema } from '../schemas.js';
import { MANAGED_INSTANCE_ID_RE, validateInstanceId } from '../validate.js';

const createInstanceSchema = z.object({
  runtime: z.enum(['openclaw', 'hermes']),
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

const renameInstanceSchema = z.object({
  name: z.string(),
});

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

  app.post('/api/fleet/instances', {
    preHandler: requireAdmin,
    attachValidation: true,
    schema: {
      tags: ['Fleet'],
      summary: 'Create a new fleet instance',
      body: {
        type: 'object',
        properties: {
          runtime: { type: 'string', enum: ['openclaw', 'hermes'] },
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
        required: ['runtime', 'kind', 'name'],
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

    const { runtime, kind, name, port, config, apiKey, image, cpuLimit, memoryLimit, portStep, enableNpmPackages } = parsed.data;
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
        runtime,
        kind,
        name,
        ...(port !== undefined ? { port } : {}),
        ...(config !== undefined ? { config: config as object } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(image !== undefined ? { image } : {}),
        ...(cpuLimit !== undefined ? { cpuLimit } : {}),
        ...(memoryLimit !== undefined ? { memoryLimit } : {}),
        ...(portStep !== undefined ? { portStep } : {}),
        ...(enableNpmPackages !== undefined ? { enableNpmPackages } : {}),
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

  app.post<{ Params: { id: string } }>('/api/fleet/instances/:id/rename', {
    preHandler: requireAdmin,
    attachValidation: true,
    schema: {
      tags: ['Fleet'],
      summary: 'Rename a fleet instance',
      params: instanceIdParamsSchema,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }

    if (request.validationError) {
      return reply.status(400).send({
        error: request.validationError.message,
        code: 'INVALID_BODY',
      });
    }

    const parsed = renameInstanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }

    const { name: nextName } = parsed.data;
    if (!MANAGED_INSTANCE_ID_RE.test(nextName)) {
      return reply.status(400).send({
        error: 'name must be lowercase alphanumeric with hyphens',
        code: 'INVALID_NAME',
      });
    }

    try {
      return await app.backend.renameInstance(id, nextName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: safeError(error), code: 'INSTANCE_NOT_FOUND' });
      }
      if (message.includes('reserved by standalone OpenClaw')) {
        return reply.status(400).send({ error: safeError(error), code: 'INVALID_NAME' });
      }
      if (message.includes('same name') || message.includes('already exists') || message.includes('locked')) {
        return reply.status(409).send({ error: safeError(error), code: 'RENAME_CONFLICT' });
      }
      if (message.includes('stopped')) {
        return reply.status(409).send({ error: safeError(error), code: 'RENAME_CONFLICT' });
      }
      return reply.status(500).send({ error: safeError(error), code: 'RENAME_FAILED' });
    }
  });
}
