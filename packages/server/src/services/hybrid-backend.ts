import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { CreateInstanceOpts, DeploymentBackend, LogHandle } from './backend.js';
import type { DockerBackend } from './docker-backend.js';
import type { HermesDockerBackend } from './hermes-docker-backend.js';
import type { ProfileBackend } from './profile-backend.js';
import type { UserService } from './user.js';
import type { FleetInstance, FleetStatus } from '../types.js';

export interface MigrateOpts {
  targetMode: 'docker' | 'profile';
  deleteSource?: boolean;
}

type HybridBackends = {
  openclawDocker: DockerBackend;
  openclawProfile: ProfileBackend;
  hermesDocker: HermesDockerBackend;
};

export class HybridBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;

  constructor(
    private backends: HybridBackends,
    private userService: UserService,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    await Promise.allSettled([
      this.backends.openclawDocker.initialize(),
      this.backends.openclawProfile.initialize(),
      this.backends.hermesDocker.initialize(),
    ]);
    await this.refresh();
  }

  async shutdown(): Promise<void> {
    await Promise.all([
      this.backends.openclawDocker.shutdown(),
      this.backends.openclawProfile.shutdown(),
      this.backends.hermesDocker.shutdown(),
    ]);
  }

  getCachedStatus(): FleetStatus | null {
    return this.mergeStatuses([
      this.backends.openclawDocker.getCachedStatus(),
      this.backends.openclawProfile.getCachedStatus(),
      this.backends.hermesDocker.getCachedStatus(),
    ]) ?? this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const [openclawDockerResult, openclawProfileResult, hermesDockerResult] = await Promise.allSettled([
      this.backends.openclawDocker.refresh(),
      this.backends.openclawProfile.refresh(),
      this.backends.hermesDocker.refresh(),
    ]);

    const statuses = [
      openclawDockerResult.status === 'fulfilled'
        ? openclawDockerResult.value
        : this.backends.openclawDocker.getCachedStatus(),
      openclawProfileResult.status === 'fulfilled'
        ? openclawProfileResult.value
        : this.backends.openclawProfile.getCachedStatus(),
      hermesDockerResult.status === 'fulfilled'
        ? hermesDockerResult.value
        : this.backends.hermesDocker.getCachedStatus(),
    ];

    const merged = this.mergeStatuses(statuses);
    if (!merged) {
      const firstError = [
        openclawDockerResult,
        openclawProfileResult,
        hermesDockerResult,
      ].find((result) => result.status === 'rejected');
      throw (firstError?.status === 'rejected' ? firstError.reason : null)
        ?? new Error('Failed to build hybrid fleet status');
    }
    this.cache = merged;
    return merged;
  }

  async start(id: string): Promise<void> {
    await (await this.backendForId(id)).start(id);
  }

  async stop(id: string): Promise<void> {
    await (await this.backendForId(id)).stop(id);
  }

  async restart(id: string): Promise<void> {
    await (await this.backendForId(id)).restart(id);
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    if (opts.name) {
      await this.ensureInstanceIdAvailable(opts.name);
    }

    const backend = this.backendForCreate(opts);
    const instance = await backend.createInstance(opts);
    await this.refresh();
    return this.getCachedStatus()?.instances.find((item) => item.id === instance.id) ?? instance;
  }

  private backendForCreate(opts: CreateInstanceOpts): DeploymentBackend {
    if (opts.runtime === 'openclaw' && opts.kind === 'docker') {
      return this.backends.openclawDocker;
    }
    if (opts.runtime === 'openclaw' && opts.kind === 'profile') {
      return this.backends.openclawProfile;
    }
    if (opts.runtime === 'hermes' && opts.kind === 'docker') {
      return this.backends.hermesDocker;
    }
    throw new Error(`Unsupported runtime/kind combination: ${opts.runtime}/${opts.kind}`);
  }

  async removeInstance(id: string): Promise<void> {
    await (await this.backendForId(id)).removeInstance(id);
    await this.refresh();
  }

  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (id === nextName) {
      throw new Error('Cannot rename an instance to the same name');
    }

    const freshStatus = await this.refresh();
    if (freshStatus.instances.some((instance) => instance.id === nextName)) {
      throw new Error(`Instance "${nextName}" already exists`);
    }
    const backend = await this.backendForId(id);
    await backend.renameInstance(id, nextName);
    try {
      await this.userService.renameAssignedProfile(id, nextName);
    } catch (error) {
      try {
        await backend.renameInstance(nextName, id);
      } catch (rollbackError) {
        await this.refresh().catch(() => {});
        const original = error instanceof Error ? error.message : String(error);
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`Failed to rewrite assignments after rename: ${original}; rollback also failed: ${rollback}`);
      }
      await this.refresh().catch(() => {});
      throw error;
    }

    const status = await this.refresh();
    const renamed = status.instances.find((instance) => instance.id === nextName);
    if (!renamed) {
      throw new Error(`Instance "${nextName}" not found after rename`);
    }
    return renamed;
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    let inner: LogHandle | null = null;
    let stopped = false;
    this.backendForId(id).then((backend) => {
      if (!stopped) inner = backend.streamLogs(id, onData);
    }).catch((err: unknown) => {
      this.log?.error({ err, id }, 'streamLogs: failed to resolve backend for instance');
    });
    return {
      stop: () => {
        stopped = true;
        inner?.stop();
      },
    };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const handles = [
      this.backends.openclawDocker.streamAllLogs(onData),
      this.backends.openclawProfile.streamAllLogs(onData),
      this.backends.hermesDocker.streamAllLogs(onData),
    ];
    return {
      stop: () => {
        for (const handle of handles) handle.stop();
      },
    };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    return (await this.backendForId(id)).execInstanceCommand(id, args);
  }

  async revealToken(id: string): Promise<string> {
    return (await this.backendForId(id)).revealToken(id);
  }

  async readInstanceConfig(id: string): Promise<object> {
    return (await this.backendForId(id)).readInstanceConfig(id);
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    await (await this.backendForId(id)).writeInstanceConfig(id, config);
  }

  async migrate(id: string, opts: MigrateOpts): Promise<FleetInstance> {
    const status = this.getCachedStatus() ?? await this.refresh();
    const source = status.instances.find((instance) => instance.id === id);
    if (!source) throw new Error(`Instance "${id}" not found`);
    if (source.mode === opts.targetMode) {
      throw new Error(`Instance "${id}" is already in ${opts.targetMode} mode`);
    }
    if (!opts.deleteSource) {
      throw new Error('deleteSource is required for migration to avoid duplicate ids');
    }

    if (opts.targetMode === 'profile') {
      if (source.runtime !== 'openclaw') {
        throw new Error(`Migration is not supported for runtime "${source.runtime}"`);
      }
      await this.backends.openclawDocker.stop(id);
      const token = await this.backends.openclawDocker.revealToken(id);
      const workspaceDir = this.backends.openclawDocker.getDockerWorkspaceDir(id);
      const configDir = this.backends.openclawDocker.getDockerConfigDir(id);
      const configFile = join(configDir, 'openclaw.json');
      if (existsSync(configFile)) unlinkSync(configFile);

      const instance = await this.backends.openclawProfile.createInstanceFromMigration({
        name: id,
        workspaceDir,
        configDir,
        token,
      });

      if (opts.deleteSource) await this.backends.openclawDocker.removeInstance(id);
      await this.refresh();
      return instance;
    }

    if (source.runtime !== 'openclaw') {
      throw new Error(`Migration is not supported for runtime "${source.runtime}"`);
    }

    await this.backends.openclawProfile.stop(id);
    const token = await this.backends.openclawProfile.revealToken(id);
    const { stateDir } = this.backends.openclawProfile.getInstanceDir(id);
    const workspaceDir = join(stateDir, 'workspace');
    const configDir = this.backends.openclawDocker.getDockerConfigDir(id);
    const configFile = join(configDir, 'openclaw.json');
    if (existsSync(configFile)) unlinkSync(configFile);

    const instance = await this.backends.openclawDocker.createInstanceFromMigration({
      name: id,
      workspaceDir,
      token,
    });

    if (opts.deleteSource) await this.backends.openclawProfile.removeInstance(id);
    await this.refresh();
    return instance;
  }

  private mergeStatuses(statuses: Array<FleetStatus | null>): FleetStatus | null {
    const present = statuses.filter((status): status is FleetStatus => status !== null);
    if (present.length === 0) return null;

    const instances = present
      .flatMap((status) => status.instances)
      .sort((left, right) => left.id.localeCompare(right.id));

    return {
      instances,
      totalRunning: instances.filter((instance) => instance.status === 'running').length,
      updatedAt: Math.max(...present.map((status) => status.updatedAt)),
    };
  }

  private async backendForId(id: string): Promise<DeploymentBackend> {
    const cachedMatches = this.getCachedStatus()?.instances.filter((item) => item.id === id) ?? [];
    if (cachedMatches.length === 1) {
      return this.backendForInstance(cachedMatches[0]);
    }
    if (cachedMatches.length > 1) {
      throw new Error(`Instance "${id}" is ambiguous across backends`);
    }

    const refreshed = await this.refresh();
    const matches = refreshed.instances.filter((item) => item.id === id);
    if (matches.length === 0) {
      throw new Error(`Instance "${id}" not found`);
    }
    if (matches.length > 1) {
      throw new Error(`Instance "${id}" is ambiguous across backends`);
    }
    return this.backendForInstance(matches[0]);
  }

  private async ensureInstanceIdAvailable(id: string): Promise<void> {
    const status = this.getCachedStatus() ?? await this.refresh();
    if (status.instances.some((instance) => instance.id === id)) {
      throw new Error(`Instance "${id}" already exists`);
    }
  }

  private backendForInstance(instance: FleetInstance): DeploymentBackend {
    if (instance.runtime === 'openclaw' && instance.mode === 'docker') {
      return this.backends.openclawDocker;
    }
    if (instance.runtime === 'openclaw' && instance.mode === 'profile') {
      return this.backends.openclawProfile;
    }
    if (instance.runtime === 'hermes' && instance.mode === 'docker') {
      return this.backends.hermesDocker;
    }
    throw new Error(`Unsupported runtime/mode combination: ${instance.runtime}/${instance.mode}`);
  }
}
