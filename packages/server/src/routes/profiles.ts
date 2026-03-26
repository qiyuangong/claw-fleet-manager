// packages/server/src/routes/profiles.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireProfileAccess } from '../authorize.js';

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const createProfileSchema = z.object({
  name: z.string().regex(PROFILE_NAME_RE, 'name must be lowercase alphanumeric with hyphens'),
  port: z.number().int().positive().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const installPluginSchema = z.object({
  spec: z.string().min(1, 'spec is required'),
});

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/fleet/profiles', { preHandler: requireAdmin }, async () => {
    const status = app.backend.getCachedStatus();
    return { instances: status?.instances ?? [], mode: 'profiles' };
  });

  app.post('/api/fleet/profiles', { preHandler: requireAdmin }, async (request, reply) => {
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

  app.delete<{ Params: { name: string } }>('/api/fleet/profiles/:name', { preHandler: requireAdmin }, async (request, reply) => {
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

  app.get<{ Params: { id: string } }>('/api/fleet/:id/plugins', { preHandler: requireProfileAccess }, async (request, reply) => {
    const { id } = request.params;
    if (!PROFILE_NAME_RE.test(id)) {
      return reply.status(400).send({ error: 'Invalid profile name', code: 'INVALID_NAME' });
    }
    try {
      const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'list', '--json']);
      return JSON.parse(stdout) as object;
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'PLUGIN_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/plugins/install', { preHandler: requireProfileAccess }, async (request, reply) => {
    const { id } = request.params;
    if (!PROFILE_NAME_RE.test(id)) {
      return reply.status(400).send({ error: 'Invalid profile name', code: 'INVALID_NAME' });
    }
    const parsed = installPluginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: parsed.error.errors[0]?.message ?? 'Invalid body',
        code: 'INVALID_BODY',
      });
    }
    try {
      const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'install', parsed.data.spec]);
      return { ok: true, output: stdout };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'PLUGIN_INSTALL_FAILED' });
    }
  });

  app.delete<{ Params: { id: string; pluginId: string } }>(
    '/api/fleet/:id/plugins/:pluginId',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id, pluginId } = request.params;
      if (!PROFILE_NAME_RE.test(id)) {
        return reply.status(400).send({ error: 'Invalid profile name', code: 'INVALID_NAME' });
      }
      if (!PLUGIN_ID_RE.test(pluginId)) {
        return reply.status(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' });
      }
      try {
        const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'uninstall', '--force', pluginId]);
        return { ok: true, output: stdout };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_UNINSTALL_FAILED' });
      }
    },
  );
}
