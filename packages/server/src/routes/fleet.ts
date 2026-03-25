// packages/server/src/routes/fleet.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const scaleSchema = z.object({ count: z.number().int().positive() });
let scaling = false;

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async () => {
    return app.backend.getCachedStatus()
      ?? { mode: app.deploymentMode, instances: [], totalRunning: 0, updatedAt: Date.now() };
  });

  app.post('/api/fleet/scale', async (request, reply) => {
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
      // scaleFleet() is on the DeploymentBackend interface; ProfileBackend throws 'not supported'
      const status = await app.backend.scaleFleet(count, app.fleetDir);
      return { ok: true, fleet: status };
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'SCALE_FAILED' });
    } finally {
      scaling = false;
    }
  });
}
