import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { configRoutes } from '../../src/routes/config.js';
import { fleetRoutes } from '../../src/routes/fleet.js';
import { healthRoutes } from '../../src/routes/health.js';
import { instanceRoutes } from '../../src/routes/instances.js';
import { userRoutes } from '../../src/routes/users.js';

const mockInstance = {
  id: 'openclaw-1',
  mode: 'docker' as const,
  index: 1,
  status: 'running' as const,
  port: 18789,
  token: 'abc1***f456',
  uptime: 100,
  cpu: 12,
  memory: { used: 400, limit: 8000 },
  disk: { config: 0, workspace: 0 },
  health: 'healthy' as const,
  image: 'openclaw:local',
};

describe('OpenAPI documentation', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.decorate('backend', {
      getCachedStatus: vi.fn().mockReturnValue({
        mode: 'hybrid',
        instances: [mockInstance],
        totalRunning: 1,
        updatedAt: Date.now(),
      }),
      refresh: vi.fn(),
      createInstance: vi.fn(),
      removeInstance: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      revealToken: vi.fn(),
      execInstanceCommand: vi.fn(),
    });
    app.decorate('deploymentMode', 'hybrid');
    app.decorate('fleetDir', '/tmp/claw-fleet-manager');
    app.decorate('fleetConfig', {
      readFleetConfig: vi.fn(),
      readFleetEnvRaw: vi.fn(),
      writeFleetConfig: vi.fn(),
      updateBaseDir: vi.fn(),
    });
    app.decorate('userService', {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      setPassword: vi.fn(),
      setAssignedProfiles: vi.fn(),
      verifyAndSetPassword: vi.fn(),
    });

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
    });

    await app.register(healthRoutes);
    await app.register(fleetRoutes);
    await app.register(instanceRoutes);
    await app.register(configRoutes);
    await app.register(userRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  it('serves OpenAPI metadata and the health endpoint docs', async () => {
    const response = await app.inject({ method: 'GET', url: '/documentation/json' });
    expect(response.statusCode).toBe(200);

    const spec = response.json();
    expect(spec.openapi).toBe('3.0.0');
    expect(spec.info).toMatchObject({
      title: 'Claw Fleet Manager API',
      description: 'HTTP API for managing openclaw instance fleets',
      version: '1.0.0',
    });
    expect(spec.paths['/api/health'].get.tags).toEqual(['System']);
    expect(spec.paths['/api/health'].get.summary).toBe('Health check');
    expect(spec.paths['/api/health'].get.responses['200']).toBeDefined();
  });

  it('documents fleet and instance operations with request and response schemas', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/documentation/json' })).json();

    expect(spec.paths['/api/fleet'].get.summary).toBe('Get current fleet status');
    expect(spec.paths['/api/fleet/scale']).toBeUndefined();
    expect(spec.paths['/api/fleet/instances'].post.responses['200']).toBeDefined();
    expect(spec.paths['/api/fleet/instances/{id}'].delete.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path', required: true })]),
    );
    expect(spec.paths['/api/fleet/{id}/start'].post.summary).toBe('Start an instance');
    expect(spec.paths['/api/fleet/{id}/token/reveal'].post.responses['200']).toBeDefined();
  });

  it('documents config and user operations', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/documentation/json' })).json();

    expect(spec.paths['/api/config/fleet'].get.tags).toEqual(['Config']);
    expect(spec.paths['/api/config/fleet'].put.requestBody).toBeDefined();
    expect(spec.paths['/api/fleet/{id}/config'].put.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path', required: true })]),
    );
    expect(spec.paths['/api/users/me'].get.summary).toBe('Get the authenticated user profile');
    expect(spec.paths['/api/users'].post.requestBody).toBeDefined();
    expect(spec.paths['/api/users/{username}/password'].put.responses['200']).toBeDefined();
    expect(spec.paths['/api/users/{username}/profiles'].put.responses['200']).toBeDefined();
  });
});
