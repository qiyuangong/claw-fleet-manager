import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import { registerAuth } from './auth.js';
import { configRoutes } from './routes/config.js';
import { fleetRoutes } from './routes/fleet.js';
import { healthRoutes } from './routes/health.js';
import { instanceRoutes } from './routes/instances.js';
import { logRoutes } from './routes/logs.js';
import { proxyRoutes } from './routes/proxy.js';
import { ComposeGenerator } from './services/compose-generator.js';
import { DockerService } from './services/docker.js';
import { FleetConfigService } from './services/fleet-config.js';
import { MonitorService, BASE_GW_PORT } from './services/monitor.js';
import { TailscaleService } from './services/tailscale.js';

const config = loadConfig();
const execFileAsync = promisify(execFile);

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

const app = Fastify({ logger: true });

const docker = new DockerService();
const fleetConfig = new FleetConfigService(config.fleetDir);
const monitor = new MonitorService(docker, fleetConfig, tailscale);
const composeGenerator = new ComposeGenerator(config.fleetDir);

app.decorate('docker', docker);
app.decorate('fleetConfig', fleetConfig);
app.decorate('monitor', monitor);
app.decorate('composeGenerator', composeGenerator);
app.decorate('fleetDir', config.fleetDir);
app.decorate('proxyAuth', Buffer.from(
  `${config.auth.username}:${config.auth.password}`,
  'utf-8',
).toString('base64'));
app.decorate('tailscale', tailscale);
app.decorate('tailscaleHostname', config.tailscale?.hostname ?? null);

await registerAuth(app, config);
await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(configRoutes);
await app.register(fleetRoutes);
await app.register(instanceRoutes);
await app.register(logRoutes);
await app.register(proxyRoutes);

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

// Suppress ECONNRESET on raw TCP sockets (e.g. abrupt WS disconnects after 401).
app.server.on('connection', (socket) => {
  socket.on('error', () => {});
});

monitor.start();

if (tailscale) {
  const containers = await docker.listFleetContainers().catch(() => []);
  const portStep = fleetConfig.readFleetConfig().portStep;
  const instances = containers.map((c) => {
    const index = parseInt(c.name.replace('openclaw-', ''), 10);
    const gwPort = BASE_GW_PORT + (index - 1) * portStep;
    return { index, gwPort };
  });
  await tailscale.syncAll(instances);
}

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Claw Fleet Manager running at http://0.0.0.0:${config.port}`);
