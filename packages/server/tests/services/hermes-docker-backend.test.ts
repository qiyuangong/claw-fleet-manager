import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'yaml';
import { HermesDockerBackend } from '../../src/services/hermes-docker-backend.js';

describe('HermesDockerBackend', () => {
  let rootDir: string;
  let backend: HermesDockerBackend;
  let mockDocker: {
    listFleetContainers: ReturnType<typeof vi.fn>;
    createManagedContainer: ReturnType<typeof vi.fn>;
    getContainerStats: ReturnType<typeof vi.fn>;
    inspectContainer: ReturnType<typeof vi.fn>;
    startContainer: ReturnType<typeof vi.fn>;
    stopContainer: ReturnType<typeof vi.fn>;
    restartContainer: ReturnType<typeof vi.fn>;
    removeContainer: ReturnType<typeof vi.fn>;
    renameContainer: ReturnType<typeof vi.fn>;
    getContainerLogs: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'hermes-docker-backend-'));
    mockDocker = {
      listFleetContainers: vi.fn().mockResolvedValue([]),
      createManagedContainer: vi.fn().mockResolvedValue(undefined),
      getContainerStats: vi.fn().mockResolvedValue({
        cpu: 12.5,
        memory: { used: 256 * 1024 * 1024, limit: 1024 * 1024 * 1024 },
      }),
      inspectContainer: vi.fn().mockResolvedValue({
        status: 'running',
        health: 'none',
        image: 'ghcr.io/nousresearch/hermes-agent:latest',
        uptime: 42,
      }),
      startContainer: vi.fn().mockResolvedValue(undefined),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      restartContainer: vi.fn().mockResolvedValue(undefined),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      renameContainer: vi.fn().mockResolvedValue(undefined),
      getContainerLogs: vi.fn().mockResolvedValue({ on: vi.fn(), destroy: vi.fn() }),
    };

    backend = new HermesDockerBackend(
      mockDocker as any,
      {
        image: 'ghcr.io/nousresearch/hermes-agent:latest',
        mountPath: '/opt/data',
        env: { HERMES_LOG_LEVEL: 'debug' },
      },
      rootDir,
    );
    await backend.initialize();
  });

  it('createInstance creates a Hermes container with persistent HERMES_HOME', async () => {
    mockDocker.listFleetContainers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: 'hermes-lab', id: 'abc', state: 'running', index: 1, runtime: 'hermes' }]);

    const instance = await backend.createInstance({ runtime: 'hermes', kind: 'docker', name: 'hermes-lab' });

    expect(mockDocker.createManagedContainer).toHaveBeenCalledWith(expect.objectContaining({
      name: 'hermes-lab',
      image: 'ghcr.io/nousresearch/hermes-agent:latest',
      binds: [expect.stringContaining('hermes-lab:/opt/data')],
      extraEnv: expect.arrayContaining([
        'HERMES_HOME=/opt/data',
        'HERMES_LOG_LEVEL=debug',
      ]),
      command: ['gateway', 'run'],
      exposedTcpPorts: [],
      runtime: 'hermes',
      healthcheck: null,
    }));

    expect(readFileSync(join(rootDir, 'hermes-lab', 'config.yaml'), 'utf-8')).toContain('gateway:');
    expect(instance.runtime).toBe('hermes');
    expect(instance.mode).toBe('docker');
  });

  it('builds Hermes fleet instances with hermes runtime metadata', async () => {
    const homeDir = join(rootDir, 'hermes-lab');
    mkdirSync(join(homeDir, 'workspace'), { recursive: true });
    writeFileSync(join(homeDir, 'config.yaml'), yaml.stringify({ agent: {}, gateway: { auth: { token: 'secret-token' } } }));
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'def', state: 'running', index: 2, runtime: 'openclaw' },
      { name: 'hermes-lab', id: 'abc', state: 'running', index: 1, runtime: 'hermes' },
    ]);

    const status = await backend.refresh();

    expect(status.instances).toHaveLength(1);
    expect(status.instances[0]).toEqual(expect.objectContaining({
      id: 'hermes-lab',
      runtime: 'hermes',
      mode: 'docker',
      status: 'running',
      health: 'healthy',
      image: 'ghcr.io/nousresearch/hermes-agent:latest',
      runtimeCapabilities: expect.objectContaining({
        configEditor: true,
        logs: true,
        proxyAccess: false,
        sessions: false,
      }),
    }));
  });

  it('refresh ignores non-Hermes managed containers', async () => {
    const homeDir = join(rootDir, 'hermes-lab');
    mkdirSync(join(homeDir, 'workspace'), { recursive: true });
    writeFileSync(join(homeDir, 'config.yaml'), yaml.stringify({ agent: {}, gateway: { auth: { token: 'secret-token' } } }));
    mockDocker.listFleetContainers.mockResolvedValue([
      { name: 'openclaw-1', id: 'def', state: 'running', index: 2, runtime: 'openclaw' },
      { name: 'hermes-lab', id: 'abc', state: 'running', index: 1, runtime: 'hermes' },
    ]);

    const status = await backend.refresh();

    expect(status.instances).toHaveLength(1);
    expect(status.instances[0].id).toBe('hermes-lab');
  });
});
