import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const scaleSchema = z.object({ count: z.number().int().positive() });

export async function fleetRoutes(app: FastifyInstance) {
  app.get('/api/fleet', async () => {
    const status = app.monitor.getStatus();
    return status ?? { instances: [], totalRunning: 0, updatedAt: Date.now() };
  });

  app.post('/api/fleet/scale', async (request, reply) => {
    const parsed = scaleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'count must be a positive integer',
        code: 'INVALID_COUNT',
      });
    }

    const { count } = parsed.data;
    const currentContainers = await app.docker.listFleetContainers();
    const toRemove = currentContainers.filter((container) => {
      const idx = parseInt(container.name.replace('openclaw-', ''), 10);
      return idx > count;
    });

    for (const container of toRemove) {
      try {
        await app.docker.stopContainer(container.name);
      } catch {
        // already stopped or not found
      }
    }

    app.composeGenerator.generate(count);

    try {
      await execFileAsync('docker', ['compose', 'up', '-d'], {
        cwd: app.fleetDir,
      });
    } catch (error: any) {
      return reply.status(500).send({ error: error.message, code: 'COMPOSE_FAILED' });
    }

    const status = await app.monitor.refresh();
    return { ok: true, fleet: status };
  });
}
