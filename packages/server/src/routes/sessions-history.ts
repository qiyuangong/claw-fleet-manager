import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../authorize.js';
import { errorResponseSchema } from '../schemas.js';
import { InvalidSessionHistoryCursorError } from '../services/session-history-errors.js';
import {
  type SessionHistoryListQuery,
  type SessionHistoryService,
} from '../services/session-history.js';

const previewItemSchema = {
  type: 'object',
  properties: {
    role: { type: 'string' },
    text: { type: 'string' },
  },
  required: ['role', 'text'],
} as const;

const sessionSchema = {
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
} as const;

const fleetSessionsHistoryResponseSchema = {
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
            items: sessionSchema,
          },
          error: { type: 'string' },
        },
        required: ['instanceId', 'sessions'],
      },
    },
    updatedAt: { type: 'number' },
    nextCursor: { type: 'string' },
    totalEstimate: { type: 'number' },
  },
  required: ['instances', 'updatedAt'],
} as const;

export async function sessionHistoryRoutes(
  app: FastifyInstance,
  options: { sessionHistory: SessionHistoryService },
) {
  app.get<{ Querystring: SessionHistoryListQuery }>('/api/fleet/sessions/history', {
    preHandler: requireAdmin,
    attachValidation: true,
    schema: {
      tags: ['Sessions'],
      summary: 'Get persisted fleet session history (admin only)',
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'integer', minimum: 0 },
          to: { type: 'integer', minimum: 0 },
          status: {
            type: 'string',
            enum: ['running', 'done', 'failed', 'killed', 'timeout', 'active', 'error'],
          },
          instanceId: { type: 'string', minLength: 1 },
          q: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          cursor: { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: fleetSessionsHistoryResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    if (request.validationError) {
      return reply.status(400).send({
        error: request.validationError.message,
        code: 'INVALID_QUERY',
      });
    }

    let page;
    try {
      page = options.sessionHistory.listSessions(request.query);
    } catch (error) {
      if (error instanceof InvalidSessionHistoryCursorError) {
        return reply.status(400).send({
          error: error.message,
          code: 'INVALID_QUERY',
        });
      }
      throw error;
    }
    const totalEstimate = options.sessionHistory.countSessions(request.query);

    return {
      instances: page.instances,
      updatedAt: Date.now(),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      ...(totalEstimate > 0 ? { totalEstimate } : {}),
    };
  });
}
