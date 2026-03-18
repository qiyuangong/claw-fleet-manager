// packages/server/src/auth.ts
import type { FastifyInstance } from 'fastify';
import fastifyBasicAuth from '@fastify/basic-auth';
import type { ServerConfig } from './types.js';

export async function registerAuth(app: FastifyInstance, config: ServerConfig) {
  await app.register(fastifyBasicAuth, {
    validate: async (username, password) => {
      if (username !== config.auth.username || password !== config.auth.password) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'Claw Fleet Manager' },
  });
  app.addHook('onRequest', app.basicAuth);
}
