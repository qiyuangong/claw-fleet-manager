import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../authorize.js';
import { errorResponseSchema } from '../schemas.js';
import { fetchInstanceSessions, type InstanceSessionRow } from '../services/openclaw-client.js';
import type { FleetInstance } from '../types.js';
import type { DeploymentBackend } from '../services/backend.js';

export type InstanceSessionsEntry = {
  instanceId: string;
  sessions: InstanceSessionRow[];
  error?: string;
};

export type FleetSessionsResult = {
  instances: InstanceSessionsEntry[];
  updatedAt: number;
};

async function fetchEntry(instance: FleetInstance, backend: DeploymentBackend): Promise<InstanceSessionsEntry> {
  try {
    const token = await backend.revealToken(instance.id);
    const sessions = await fetchInstanceSessions(instance.port, token);
    return { instanceId: instance.id, sessions };
  } catch (err) {
    return {
      instanceId: instance.id,
      sessions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const fleetSessionsResponseSchema = {
  type: 'object',
  properties: {
    instances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          instanceId: { type: 'string' },
          sessions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                displayName: { type: 'string' },
                derivedTitle: { type: 'string' },
                lastMessagePreview: { type: 'string' },
                status: { type: 'string', enum: ['running', 'done', 'failed', 'killed', 'timeout'] },
                startedAt: { type: 'number' },
                endedAt: { type: 'number' },
                runtimeMs: { type: 'number' },
                model: { type: 'string' },
                modelProvider: { type: 'string' },
                kind: { type: 'string' },
              },
              required: ['key'],
            },
          },
          error: { type: 'string' },
        },
        required: ['instanceId', 'sessions'],
      },
    },
    updatedAt: { type: 'number' },
  },
  required: ['instances', 'updatedAt'],
} as const;

export async function sessionRoutes(app: FastifyInstance) {
  app.get<{ Reply: FleetSessionsResult }>('/api/fleet/sessions', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Sessions'],
      summary: 'Get recent sessions across all running instances (admin only)',
      response: {
        200: fleetSessionsResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async () => {
    const status = app.backend.getCachedStatus();
    const running = (status?.instances ?? []).filter((i) => i.status === 'running');
    const instances = await Promise.all(running.map((i) => fetchEntry(i, app.backend)));
    return { instances, updatedAt: Date.now() };
  });
}
