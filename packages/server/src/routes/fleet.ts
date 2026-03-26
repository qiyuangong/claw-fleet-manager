// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../authorize.js';

const scaleSchema = z.object({ count: z.number().int().positive() });
let scaling = false;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async (request) => {
    const status = app.backend.getCachedStatus()
      ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
    if (!request.user || request.user.role === 'admin') return status;
    // Filter instances to assigned profiles only for non-admin users
    const assigned = new Set(request.user.assignedProfiles);
    return {
      ...status,
      instances: status.instances.filter((i) => assigned.has(i.id)),
      totalRunning: status.instances.filter((i) => assigned.has(i.id) && i.status === 'running').length,
    };
  });

  app.post('/api/fleet/scale', { preHandler: requireAdmin }, async (request, reply) => {
    if (app.deploymentMode === 'profiles') {
      return reply.status(400).send({
        error: 'scale endpoint not available in profile mode — use POST /api/fleet/profiles',
        code: 'WRONG_MODE',
      });
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
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'SCALE_FAILED' });
    } finally {
      scaling = false;
    }
  });
}
