// packages/server/src/routes/health.ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    return { ok: true, timestamp: Date.now() };
  });
}
