import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BASE_GW_PORT } from '../services/monitor.js';

const execFileAsync = promisify(execFile);
const scaleSchema = z.object({ count: z.number().int().positive() });
let scaling = false;

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

    if (scaling) {
      return reply.status(409).send({ error: 'Scale operation already in progress', code: 'SCALE_IN_PROGRESS' });
    }
    scaling = true;

    try {
      const { count } = parsed.data;
      const currentContainers = await app.docker.listFleetContainers();
      const currentIndices = currentContainers.map((c) =>
        parseInt(c.name.replace('openclaw-', ''), 10),
      );
      const newIndices = Array.from({ length: count }, (_, i) => i + 1).filter(
        (i) => !currentIndices.includes(i),
      );
      const removedIndices = currentIndices.filter((i) => i > count);

      // Stop removed containers
      for (const container of currentContainers.filter((c) => {
        const idx = parseInt(c.name.replace('openclaw-', ''), 10);
        return idx > count;
      })) {
        try {
          await app.docker.stopContainer(container.name);
        } catch {
          // already stopped or not found
        }
      }

      // Teardown Tailscale for removed instances (non-fatal)
      for (const idx of removedIndices) {
        await app.tailscale?.teardown(idx);
      }

      // Allocate Tailscale ports for new instances before generating compose
      const portMap = app.tailscale?.allocatePorts(newIndices) ?? new Map<number, number>();

      // Generate compose + openclaw.json
      app.composeGenerator.generate(
        count,
        app.tailscaleHostname ? { hostname: app.tailscaleHostname, portMap } : undefined,
      );

      try {
        await execFileAsync('docker', ['compose', 'up', '-d'], { cwd: app.fleetDir });
      } catch (error: any) {
        return reply.status(500).send({ error: error.message, code: 'COMPOSE_FAILED' });
      }

      // Setup Tailscale serve for new instances (non-fatal per instance)
      const portStep = app.fleetConfig.readFleetConfig().portStep;
      for (const idx of newIndices) {
        const gwPort = BASE_GW_PORT + (idx - 1) * portStep;
        try {
          await app.tailscale?.setup(idx, gwPort);
        } catch (err) {
          app.log.error({ err, idx }, 'Tailscale setup failed for instance');
        }
      }

      const status = await app.monitor.refresh();
      return { ok: true, fleet: status };
    } finally {
      scaling = false;
    }
  });
}
