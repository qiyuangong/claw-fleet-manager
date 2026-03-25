// packages/server/src/index.ts
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { configRoutes } from './routes/config.js';
import { fleetRoutes } from './routes/fleet.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { logRoutes } from './routes/logs.js';
import { proxyRoutes } from './routes/proxy.js';
import type { DeploymentBackend } from './services/backend.js';
import { DockerBackend } from './services/docker-backend.js';
import { ProfileBackend } from './services/profile-backend.js';
import { ComposeGenerator } from './services/compose-generator.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { TailscaleService } from './services/tailscale.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const config = loadConfig();

// ── Tailscale preflight (Docker mode only) ──────────────────────────────────
let tailscale: TailscaleService | null = null;
if (config.deploymentMode !== 'profiles' && config.tailscale) {
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

// ── Shared services ──────────────────────────────────────────────────────────
const fleetConfig = new FleetConfigService(config.fleetDir);

// ── Backend factory ──────────────────────────────────────────────────────────
const backend = config.deploymentMode === 'profiles'
  ? new ProfileBackend(config.fleetDir, config.profiles ?? {
      openclawBinary: 'openclaw',
      basePort: 18789,
      portStep: 20,
      stateBaseDir: `${process.env.HOME}/.openclaw-states`,
      configBaseDir: `${process.env.HOME}/.openclaw-configs`,
      autoRestart: true,
      stopTimeoutMs: 10000,
    }, app.log)
  : new DockerBackend(
      new DockerService(),
      new ComposeGenerator(config.fleetDir),
      fleetConfig,
      config.fleetDir,
      tailscale,
      config.tailscale?.hostname ?? null,
      app.log,
    );

// ── Decorators ───────────────────────────────────────────────────────────────
app.decorate('backend', backend as DeploymentBackend);
app.decorate('deploymentMode', config.deploymentMode ?? 'docker');
app.decorate('fleetConfig', fleetConfig);
app.decorate('fleetDir', config.fleetDir);
app.decorate('proxyAuth', Buffer.from(
  `${config.auth.username}:${config.auth.password}`, 'utf-8',
).toString('base64'));

// ── Routes ───────────────────────────────────────────────────────────────────
await registerAuth(app, config);
await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(configRoutes);
await app.register(fleetRoutes);
await app.register(instanceRoutes);
await app.register(logRoutes);
await app.register(proxyRoutes);

if (config.deploymentMode === 'profiles') {
  const { profileRoutes } = await import('./routes/profiles.js');
  await app.register(profileRoutes);
}

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
