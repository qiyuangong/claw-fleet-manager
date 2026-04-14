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

type FleetSessionsQuery = {
  status?: InstanceSessionRow['status'];
  previewLimit?: number;
};

async function fetchEntry(
  instance: FleetInstance,
  backend: DeploymentBackend,
  query: FleetSessionsQuery,
): Promise<InstanceSessionsEntry> {
  try {
    const token = await backend.revealToken(instance.id);
    const sessions = await fetchInstanceSessions(instance.port, token, 5_000, query);
    const filteredSessions = query.status
      ? sessions.filter((session) => session.status === query.status)
      : sessions;
    return { instanceId: instance.id, sessions: filteredSessions };
  } catch (err) {
    return {
      instanceId: instance.id,
      sessions: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const previewItemSchema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['role', 'text'],
} as const;

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
                previewItems: {
                  type: 'array',
                  items: previewItemSchema,
                },
                status: { type: 'string', enum: ['running', 'done', 'failed', 'killed', 'timeout'] },
                startedAt: { type: 'number' },
                endedAt: { type: 'number' },
                runtimeMs: { type: 'number' },
                model: { type: 'string' },
                modelProvider: { type: 'string' },
                kind: { type: 'string' },
                inputTokens: { type: 'number' },
                outputTokens: { type: 'number' },
                totalTokens: { type: 'number' },
                estimatedCostUsd: { type: 'number' },
                updatedAt: { type: 'number' },
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
  app.get<{ Querystring: FleetSessionsQuery; Reply: FleetSessionsResult }>('/api/fleet/sessions', {
    preHandler: requireAdmin,
    schema: {
      tags: ['Sessions'],
      summary: 'Get recent sessions across all running instances (admin only)',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'done', 'failed', 'killed', 'timeout'] },
          previewLimit: { type: 'integer', minimum: 0, maximum: 8 },
        },
      },
      response: {
        200: fleetSessionsResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request) => {
    const status = app.backend.getCachedStatus();
    const running = (status?.instances ?? []).filter((instance) =>
      instance.status === 'running' && instance.runtimeCapabilities.sessions,
    );
    const instances = await Promise.all(running.map((i) => fetchEntry(i, app.backend, request.query)));
    return { instances, updatedAt: Date.now() };
  });
}
