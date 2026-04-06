import type { DeploymentBackend } from './services/backend.js';
import type { FleetConfigService } from './services/fleet-config.js';
import type { UserService } from './services/user.js';
import type { User } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    backend: DeploymentBackend;
    fleetConfig: FleetConfigService;
    fleetDir: string;
    userService: UserService;
  }
  interface FastifyRequest {
    user: User;
  }
}
