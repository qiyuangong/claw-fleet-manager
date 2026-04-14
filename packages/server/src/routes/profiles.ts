// packages/server/src/routes/profiles.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { getManagedProfileNameError, isValidManagedProfileName } from '../profile-names.js';
import { errorResponseSchema, fleetInstanceSchema, okResponseSchema } from '../schemas.js';

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

const createProfileSchema = z.object({
  name: z.string().superRefine((value, ctx) => {
    if (!isValidManagedProfileName(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: getManagedProfileNameError(value),
      });
    }
  }),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const profileListResponseSchema = {
  type: 'object',
  properties: {
    instances: {
      type: 'array',
      items: fleetInstanceSchema,
    },
    mode: { type: 'string', enum: ['profiles'] },
  },
  required: ['instances', 'mode'],
} as const;

const profileNameParamsSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', pattern: PROFILE_NAME_RE.source },
  },
  required: ['name'],
} as const;

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/fleet/profiles', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Profiles'],
      summary: 'List managed OpenClaw profile instances',
      response: {
        200: profileListResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async () => {
    const status = app.backend.getCachedStatus();
    return {
      instances: status?.instances.filter((instance) => instance.mode === 'profile') ?? [],
      mode: 'profiles',
    };
  });

  app.post('/api/fleet/profiles', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Profiles'],
      summary: 'Create a managed OpenClaw profile instance',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: PROFILE_NAME_RE.source },
          port: { type: 'integer', minimum: 1 },
          config: { type: 'object', additionalProperties: true },
        },
        required: ['name'],
      },
      response: {
        200: fleetInstanceSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        409: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = createProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }
    try {
      const { name, port, config } = parsed.data;
      const instance = await app.backend.createInstance({
        runtime: 'openclaw',
        kind: 'profile',
        name,
        ...(port !== undefined ? { port } : {}),
        ...(config !== undefined ? { config: config as object } : {}),
      });
      return instance;
    } catch (error: any) {
      const code = error.message?.includes('already exists') ? 409
        : error.message?.includes('in use') ? 409 : 500;
      return reply.status(code).send({ error: error.message, code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { name: string } }>('/api/fleet/profiles/:name', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Profiles'],
      summary: 'Delete a managed OpenClaw profile instance',
      params: profileNameParamsSchema,
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
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
