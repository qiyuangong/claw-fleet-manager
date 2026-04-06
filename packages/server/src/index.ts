// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, resolveConfigPath } from './config.js';
import { registerAuth } from './auth.js';
import { configRoutes } from './routes/config.js';
import { fleetRoutes } from './routes/fleet.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { logRoutes } from './routes/logs.js';
import { migrateRoutes } from './routes/migrate.js';
import { pluginRoutes } from './routes/plugins.js';
import { userRoutes } from './routes/users.js';
import { proxyRoutes } from './routes/proxy.js';
import type { DeploymentBackend } from './services/backend.js';
import { DockerBackend } from './services/docker-backend.js';
import { HybridBackend } from './services/hybrid-backend.js';
import { ProfileBackend } from './services/profile-backend.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { UserService } from './services/user.js';
import { TailscaleService } from './services/tailscale.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const config = loadConfig();

// ── Tailscale preflight (Docker mode only) ──────────────────────────────────
let tailscale: TailscaleService | null = null;
if (config.tailscale) {
  try {
    await execFileAsync('tailscale', ['version']);
  } catch {
    console.error(
      'ERROR: tailscale.hostname is configured but the tailscale CLI is not available.\n' +
      'Install and authenticate Tailscale before starting the fleet manager.',
    );
    process.exit(1);
  }
  tailscale = new TailscaleService(config.fleetDir, config.tailscale.hostname);
}

// ── TLS ─────────────────────────────────────────────────────────────────────
const httpsOptions = config.tls
  ? { key: readFileSync(resolve(config.tls.key)), cert: readFileSync(resolve(config.tls.cert)) }
  : undefined;

const app = Fastify({ logger: true, ...(httpsOptions ? { https: httpsOptions } : {}) });

await app.register(fastifySwagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Claw Fleet Manager API',
      description: 'HTTP API for managing openclaw instance fleets',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        basicAuth: {
          type: 'http',
          scheme: 'basic',
        },
      },
    },
    security: [{ basicAuth: [] }],
  },
});

await app.register(fastifySwaggerUi, {
  routePrefix: '/documentation',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: true,
  },
});

// ── Shared services ──────────────────────────────────────────────────────────
const fleetConfig = new FleetConfigService(config.fleetDir, config.baseDir, resolveConfigPath());
const userService = new UserService(config.fleetDir);
await userService.initialize(config.auth);

// ── Backend factory ──────────────────────────────────────────────────────────
const dockerBackend = new DockerBackend(
  new DockerService(),
  fleetConfig,
  config.fleetDir,
  tailscale,
  config.tailscale?.hostname ?? null,
  app.log,
);
const profileBackend = new ProfileBackend(config.fleetDir, config.profiles ?? {
  openclawBinary: 'openclaw',
  basePort: 18789,
  portStep: 20,
  stateBaseDir: `${process.env.HOME}/.openclaw-states`,
  configBaseDir: `${process.env.HOME}/.openclaw-configs`,
  autoRestart: true,
  stopTimeoutMs: 10000,
}, config.baseDir, app.log);
const backend = new HybridBackend(dockerBackend, profileBackend);

// ── Decorators ───────────────────────────────────────────────────────────────
app.decorate('backend', backend as DeploymentBackend);
app.decorate('fleetConfig', fleetConfig);
app.decorate('fleetDir', config.fleetDir);
app.decorate('userService', userService);

// ── Routes ───────────────────────────────────────────────────────────────────
await registerAuth(app, userService, { secure: !!httpsOptions });
await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(configRoutes);
await app.register(fleetRoutes);
await app.register(instanceRoutes);
await app.register(migrateRoutes);
await app.register(userRoutes);
await app.register(logRoutes);
await app.register(proxyRoutes);
await app.register(pluginRoutes);

const { profileRoutes } = await import('./routes/profiles.js');
await app.register(profileRoutes);

const webDist = resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: '/' });
  app.setNotFoundHandler((request, reply) => {
    if (
      request.url.startsWith('/api/') ||
      request.url.startsWith('/ws/') ||
      request.url.startsWith('/proxy/') ||
      request.url.startsWith('/proxy-ws/')
    ) {
      return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
    }
    return reply.sendFile('index.html');
  });
}

app.server.on('connection', (socket) => { socket.on('error', () => {}); });

// ── Startup ──────────────────────────────────────────────────────────────────
await backend.initialize();

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  await backend.shutdown();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await app.listen({ port: config.port, host: '0.0.0.0' });
const proto = config.tls ? 'https' : 'http';
console.log(`Claw Fleet Manager running at ${proto}://0.0.0.0:${config.port}`);
