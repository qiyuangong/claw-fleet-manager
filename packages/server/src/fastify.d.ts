import type { ComposeGenerator } from './services/compose-generator.js';
import type { DockerService } from './services/docker.js';
import type { FleetConfigService } from './services/fleet-config.js';
import type { MonitorService } from './services/monitor.js';

declare module 'fastify' {
  interface FastifyInstance {
    monitor: MonitorService;
    docker: DockerService;
    fleetConfig: FleetConfigService;
    composeGenerator: ComposeGenerator;
    fleetDir: string;
    proxyAuth: string;
  }
}
