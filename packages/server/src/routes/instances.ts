// packages/server/src/routes/instances.ts
import type { FastifyInstance } from 'fastify';
import { validateInstanceId } from '../validate.js';
import { requireProfileAccess } from '../authorize.js';
import { safeError } from '../errors.js';
import { errorResponseSchema, fleetInstanceSchema, instanceIdParamsSchema, okResponseSchema } from '../schemas.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FEISHU_CODE_RE = /^[A-Za-z0-9]{3,32}$/;

const requestIdParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    requestId: { type: 'string' },
  },
  required: ['id', 'requestId'],
} as const;

const pairingCodeParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    code: { type: 'string' },
  },
  required: ['id', 'code'],
} as const;

const lifecycleResponseSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    instance: fleetInstanceSchema,
  },
  required: ['ok'],
} as const;

const pendingDevicesResponseSchema = {
  type: 'object',
  properties: {
    pending: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          ip: { type: 'string' },
        },
        required: ['requestId', 'ip'],
      },
    },
  },
  required: ['pending'],
} as const;

const feishuPairingResponseSchema = {
  type: 'object',
  properties: {
    pending: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          userId: { type: 'string' },
        },
        required: ['code'],
      },
    },
    raw: { type: 'string' },
  },
  required: ['pending', 'raw'],
} as const;

const tokenRevealResponseSchema = {
  type: 'object',
  properties: {
    token: { type: 'string' },
  },
  required: ['token'],
} as const;

function instanceActionSchema(action: 'start' | 'stop' | 'restart') {
  const summary = `${action[0].toUpperCase()}${action.slice(1)} an instance`;
  return {
    tags: ['Instances'],
    summary,
    params: instanceIdParamsSchema,
    response: {
      200: lifecycleResponseSchema,
      400: errorResponseSchema,
      500: errorResponseSchema,
    },
  } as const;
}

function parseFeishuPairing(stdout: string): { code: string; userId?: string }[] {
  const results: { code: string; userId?: string }[] = [];
  const headerWords = new Set(['PENDING', 'CODE', 'STATUS', 'USER', 'TIME', 'REQUEST']);
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('=')) continue;
    const codeMatch = trimmed.match(/\b([A-Z0-9]{4,12})\b/);
    const userIdMatch = trimmed.match(/\b(ou_[a-zA-Z0-9_]+)\b/);
    if (codeMatch && !headerWords.has(codeMatch[1])) {
      results.push({ code: codeMatch[1], userId: userIdMatch?.[1] });
    }
  }
  return results;
}

function parsePendingDevices(output: string): { requestId: string; ip: string }[] {
  const pendingSection = output.split(/\nPaired/)[0];
  const devices: { requestId: string; ip: string }[] = [];
  for (const line of pendingSection.split('\n')) {
    const uuidMatch = line.match(/│\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+│/);
    if (!uuidMatch) continue;
    const ipMatch = line.match(/│[^│]*│[^│]*│[^│]*│\s+([\d.]+)\s+│/);
    devices.push({ requestId: uuidMatch[1], ip: ipMatch?.[1] ?? 'unknown' });
  }
  return devices;
}

export async function instanceRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/fleet/:id/start', {
    preHandler: requireProfileAccess,
    schema: instanceActionSchema('start'),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.start(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: unknown) {
      return reply.status(500).send({ error: `Failed to start instance ${id}: ${safeError(error)}`, code: 'START_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/stop', {
    preHandler: requireProfileAccess,
    schema: instanceActionSchema('stop'),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.stop(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: unknown) {
      return reply.status(500).send({ error: `Failed to stop instance ${id}: ${safeError(error)}`, code: 'STOP_FAILED' });
    }
  });

  app.post<{ Params: { id: string } }>('/api/fleet/:id/restart', {
    preHandler: requireProfileAccess,
    schema: instanceActionSchema('restart'),
  }, async (request, reply) => {
    const { id } = request.params;
    if (!validateInstanceId(id)) {
      return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
    }
    try {
      await app.backend.restart(id);
      const status = await app.backend.refresh();
      const instance = status.instances.find((item) => item.id === id);
      return { ok: true, instance };
    } catch (error: unknown) {
      return reply.status(500).send({ error: `Failed to restart instance ${id}: ${safeError(error)}`, code: 'RESTART_FAILED' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/fleet/:id/devices/pending', {
    preHandler: requireProfileAccess,
    schema: {
      tags: ['Instances'],
      summary: 'List pending device approvals for an instance',
      params: instanceIdParamsSchema,
      response: {
        200: pendingDevicesResponseSchema,
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
      const stdout = await app.backend.execInstanceCommand(id, ['devices', 'list']);
      return { pending: parsePendingDevices(stdout) };
    } catch (error: unknown) {
      return reply.status(500).send({ error: `Failed to list devices for instance ${id}: ${safeError(error)}`, code: 'DEVICES_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; requestId: string } }>(
    '/api/fleet/:id/devices/:requestId/approve',
    {
      preHandler: requireProfileAccess,
      schema: {
        tags: ['Instances'],
        summary: 'Approve a pending device for an instance',
        params: requestIdParamsSchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, requestId } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!UUID_RE.test(requestId)) {
        return reply.status(400).send({ error: 'Invalid requestId', code: 'INVALID_REQUEST_ID' });
      }
      try {
        await app.backend.execInstanceCommand(id, ['devices', 'approve', requestId]);
        return { ok: true };
      } catch (error: unknown) {
        return reply.status(500).send({ error: `Failed to approve device ${requestId} for instance ${id}: ${safeError(error)}`, code: 'APPROVE_FAILED' });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/fleet/:id/feishu/pairing', {
    preHandler: requireProfileAccess,
    schema: {
      tags: ['Instances'],
      summary: 'List pending Feishu pairings for an instance',
      params: instanceIdParamsSchema,
      response: {
        200: feishuPairingResponseSchema,
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
      const stdout = await app.backend.execInstanceCommand(id, ['pairing', 'list', 'feishu']);
      return { pending: parseFeishuPairing(stdout), raw: stdout };
    } catch (error: unknown) {
      return reply.status(500).send({ error: `Failed to list Feishu pairings for instance ${id}: ${safeError(error)}`, code: 'FEISHU_LIST_FAILED' });
    }
  });

  app.post<{ Params: { id: string; code: string } }>(
    '/api/fleet/:id/feishu/pairing/:code/approve',
    {
      preHandler: requireProfileAccess,
      schema: {
        tags: ['Instances'],
        summary: 'Approve a Feishu pairing for an instance',
        params: pairingCodeParamsSchema,
        response: {
          200: okResponseSchema,
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, code } = request.params;
      if (!validateInstanceId(id)) {
        return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
      }
      if (!FEISHU_CODE_RE.test(code)) {
        return reply.status(400).send({ error: 'Invalid pairing code', code: 'INVALID_CODE' });
      }
      try {
        await app.backend.execInstanceCommand(id, ['pairing', 'approve', 'feishu', code]);
        return { ok: true };
      } catch (error: unknown) {
        return reply.status(500).send({ error: `Failed to approve Feishu pairing ${code} for instance ${id}: ${safeError(error)}`, code: 'FEISHU_APPROVE_FAILED' });
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/fleet/:id/token/reveal', {
    preHandler: requireProfileAccess,
    schema: {
      tags: ['Instances'],
      summary: 'Reveal the full gateway token for an instance',
      params: instanceIdParamsSchema,
      response: {
        200: tokenRevealResponseSchema,
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
      const token = await app.backend.revealToken(id);
      request.log.info({ instance: id }, 'Token revealed');
      return { token };
    } catch {
      return reply.status(404).send({ error: `Token not found for instance ${id}`, code: 'TOKEN_NOT_FOUND' });
    }
  });
}
