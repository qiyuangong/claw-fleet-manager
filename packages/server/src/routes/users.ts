// packages/server/src/routes/users.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';
import { errorResponseSchema, okResponseSchema } from '../schemas.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const createUserSchema = z.object({
  username: z.string().regex(USERNAME_RE, 'username must be lowercase alphanumeric with underscores/hyphens'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  role: z.enum(['admin', 'user']),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'password must be at least 8 characters'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'newPassword must be at least 8 characters'),
});

const setProfilesSchema = z.object({
  profiles: z.array(z.string()),
});

const publicUserSchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'user'] },
    assignedProfiles: { type: 'array', items: { type: 'string' } },
  },
  required: ['username', 'role', 'assignedProfiles'],
} as const;

const usernameParamsSchema = {
  type: 'object',
  properties: {
    username: { type: 'string' },
  },
  required: ['username'],
} as const;

export async function userRoutes(app: FastifyInstance) {
  // Self-service — registered BEFORE parametric /:username routes
  app.get('/api/users/me', {
    schema: {
      tags: ['Users'],
      summary: 'Get the authenticated user profile',
      response: {
        200: publicUserSchema,
      },
    },
  }, async (request) => {
    const { passwordHash: _, ...pub } = request.user;
    return pub;
  });

  app.put('/api/users/me/password', {
    schema: {
      tags: ['Users'],
      summary: 'Change the authenticated user password',
      body: {
        type: 'object',
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 8 },
        },
        required: ['currentPassword', 'newPassword'],
      },
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        422: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.verifyAndSetPassword(
        request.user.username,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      return { ok: true };
    } catch (error: any) {
      if (error.message?.includes('incorrect')) {
        return reply.status(422).send({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
      }
      return reply.status(400).send({ error: error.message, code: 'PASSWORD_CHANGE_FAILED' });
    }
  });

  // Admin-only routes
  app.get('/api/users', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Users'],
      summary: 'List all users',
      response: {
        200: {
          type: 'array',
          items: publicUserSchema,
        },
        403: errorResponseSchema,
      },
    },
  }, async () => {
    return app.userService.list();
  });

  app.post('/api/users', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Users'],
      summary: 'Create a new user',
      body: {
        type: 'object',
        properties: {
          username: { type: 'string', pattern: USERNAME_RE.source },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
        required: ['username', 'password', 'role'],
      },
      response: {
        201: publicUserSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      const user = await app.userService.create(parsed.data.username, parsed.data.password, parsed.data.role);
      return reply.status(201).send(user);
    } catch (error: any) {
      const code = error.message?.includes('already exists') ? 409 : 400;
      return reply.status(code).send({ error: error.message, code: 'CREATE_FAILED' });
    }
  });

  app.delete<{ Params: { username: string } }>('/api/users/:username', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Users'],
      summary: 'Delete a user',
      params: usernameParamsSchema,
      response: {
        200: okResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    try {
      await app.userService.delete(request.params.username, request.user.username);
      return { ok: true };
    } catch (error: any) {
      const code = error.message?.includes('self') || error.message?.includes('last admin') ? 403 : 404;
      return reply.status(code).send({ error: error.message, code: 'DELETE_FAILED' });
    }
  });

  app.put<{ Params: { username: string } }>('/api/users/:username/password', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Users'],
      summary: 'Reset a user password',
      params: usernameParamsSchema,
      body: {
        type: 'object',
        properties: {
          password: { type: 'string', minLength: 8 },
        },
        required: ['password'],
      },
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0]?.message ?? 'Invalid body', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.setPassword(request.params.username, parsed.data.password);
      return { ok: true };
    } catch (error: any) {
      return reply.status(404).send({ error: error.message, code: 'USER_NOT_FOUND' });
    }
  });

  app.put<{ Params: { username: string } }>('/api/users/:username/profiles', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Users'],
      summary: 'Set assigned profiles for a user',
      params: usernameParamsSchema,
      body: {
        type: 'object',
        properties: {
          profiles: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['profiles'],
      },
      response: {
        200: okResponseSchema,
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const parsed = setProfilesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'profiles must be an array of strings', code: 'INVALID_BODY' });
    }
    try {
      await app.userService.setAssignedProfiles(request.params.username, parsed.data.profiles);
      return { ok: true };
    } catch (error: any) {
      const code = error.message?.includes('Invalid profile') ? 400 : 404;
      return reply.status(code).send({ error: error.message, code: 'SET_PROFILES_FAILED' });
    }
  });
}
