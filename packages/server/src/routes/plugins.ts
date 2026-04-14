import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireProfileAccess } from '../authorize.js';
import type { FleetInstance } from '../types.js';
import { validateInstanceId } from '../validate.js';

const installPluginSchema = z.object({
  spec: z.string().min(1, 'spec is required'),
});

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function parseCliJson(stdout: string): object {
  const ansiStripped = stdout.replace(/\u001b\[[0-9;]*m/g, '');
  const jsonStart = ansiStripped.indexOf('{');
  if (jsonStart < 0) {
    throw new Error('CLI did not return JSON output');
  }
  return JSON.parse(ansiStripped.slice(jsonStart)) as object;
}

async function findInstance(app: FastifyInstance, id: string): Promise<FleetInstance | undefined> {
  const cached = app.backend.getCachedStatus?.()?.instances.find((instance: FleetInstance) => instance.id === id);
  if (cached) return cached;
  const refreshed = await app.backend.refresh?.();
  return refreshed?.instances.find((instance: FleetInstance) => instance.id === id);
}

async function requirePluginSupport(app: FastifyInstance, id: string) {
  const instance = await findInstance(app, id);
  if (!instance) {
    return {
      ok: false as const,
      statusCode: 404,
      body: { error: `Instance "${id}" not found`, code: 'INSTANCE_NOT_FOUND' },
    };
  }
  if (!instance.runtimeCapabilities.plugins) {
    return {
      ok: false as const,
      statusCode: 409,
      body: { error: `Instance "${id}" does not support this action`, code: 'UNSUPPORTED_RUNTIME_ACTION' },
    };
  }
  return { ok: true as const, instance };
}

export async function pluginRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/api/fleet/:id/plugins',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      const support = await requirePluginSupport(app, id);
      if (!support.ok) {
        return reply.status(support.statusCode).send(support.body);
      }

      try {
        const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'list', '--json']);
        return parseCliJson(stdout);
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_LIST_FAILED' });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/fleet/:id/plugins/install',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }

      const parsed = installPluginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: parsed.error.errors[0]?.message ?? 'Invalid body',
          code: 'INVALID_BODY',
        });
      }
      const support = await requirePluginSupport(app, id);
      if (!support.ok) {
        return reply.status(support.statusCode).send(support.body);
      }

      try {
        const stdout = await app.backend.execInstanceCommand(id, ['plugins', 'install', parsed.data.spec]);
        return { ok: true, output: stdout };
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'PLUGIN_INSTALL_FAILED' });
      }
    },
  );

  app.delete<{ Params: { id: string; pluginId: string } }>(
    '/api/fleet/:id/plugins/:pluginId',
    { preHandler: requireProfileAccess },
    async (request, reply) => {
      const { id, pluginId } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!PLUGIN_ID_RE.test(pluginId)) {
        return reply.status(400).send({ error: 'Invalid plugin id', code: 'INVALID_PLUGIN_ID' });
      }
      const support = await requirePluginSupport(app, id);
      if (!support.ok) {
        return reply.status(support.statusCode).send(support.body);
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
