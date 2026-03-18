// packages/server/src/index.ts
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { healthRoutes } from './routes/health.js';

const config = loadConfig();
const app = Fastify({ logger: true });

await registerAuth(app, config);
await app.register(healthRoutes);

await app.listen({ port: config.port, host: '0.0.0.0' });
