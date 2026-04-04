// packages/server/src/routes/health.ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', {
    schema: {
      tags: ['System'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            timestamp: { type: 'number' },
          },
          required: ['ok', 'timestamp'],
        },
      },
    },
  }, async () => {
    return { ok: true, timestamp: Date.now() };
  });
}
