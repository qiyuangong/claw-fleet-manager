import type { DeploymentBackend } from './services/backend.js';
import type { FleetConfigService } from './services/fleet-config.js';

declare module 'fastify' {
  interface FastifyInstance {
    backend: DeploymentBackend;
    deploymentMode: 'docker' | 'profiles';
    fleetConfig: FleetConfigService;
    fleetDir: string;
    proxyAuth: string;
  }
}
