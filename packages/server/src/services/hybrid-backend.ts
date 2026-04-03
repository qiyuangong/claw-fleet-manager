import type { CreateInstanceOpts, DeploymentBackend, LogHandle } from './backend.js';
import type { FleetInstance, FleetStatus } from '../types.js';

export class HybridBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;

  constructor(
    private dockerBackend: DeploymentBackend,
    private profileBackend: DeploymentBackend,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([this.dockerBackend.initialize(), this.profileBackend.initialize()]);
    await this.refresh();
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.dockerBackend.shutdown(), this.profileBackend.shutdown()]);
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache ?? this.mergeStatuses(
      this.dockerBackend.getCachedStatus(),
      this.profileBackend.getCachedStatus(),
    );
  }

  async refresh(): Promise<FleetStatus> {
    const [dockerStatus, profileStatus] = await Promise.all([
      this.dockerBackend.refresh(),
      this.profileBackend.refresh(),
    ]);
    const merged = this.mergeStatuses(dockerStatus, profileStatus);
    if (!merged) {
      throw new Error('Failed to build hybrid fleet status');
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
    if (opts.kind === 'docker') {
      const instance = await this.dockerBackend.createInstance(opts);
      await this.refresh();
      return this.getCachedStatus()?.instances.find((item) => item.id === instance.id) ?? instance;
    }
    if (opts.kind === 'profile') {
      const instance = await this.profileBackend.createInstance(opts);
      await this.refresh();
      return this.getCachedStatus()?.instances.find((item) => item.id === instance.id) ?? instance;
    }
    throw new Error('kind is required');
  }

  async removeInstance(id: string): Promise<void> {
    await (await this.backendForId(id)).removeInstance(id);
    await this.refresh();
  }

  async scaleFleet(count: number, fleetDir: string): Promise<FleetStatus> {
    await this.dockerBackend.scaleFleet(count, fleetDir);
    return this.refresh();
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    const backend = this.backendForIdSync(id);
    return backend.streamLogs(id, onData);
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const handles = [
      this.dockerBackend.streamAllLogs(onData),
      this.profileBackend.streamAllLogs(onData),
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

  private mergeStatuses(dockerStatus: FleetStatus | null, profileStatus: FleetStatus | null): FleetStatus | null {
    if (!dockerStatus && !profileStatus) return null;

    const instances = [
      ...(dockerStatus?.instances ?? []),
      ...(profileStatus?.instances ?? []),
    ].sort((left, right) => left.id.localeCompare(right.id));

    return {
      mode: 'hybrid',
      instances,
      totalRunning: instances.filter((instance) => instance.status === 'running').length,
      updatedAt: Math.max(dockerStatus?.updatedAt ?? 0, profileStatus?.updatedAt ?? 0),
    };
  }

  private backendForIdSync(id: string): DeploymentBackend {
    const instance = this.getCachedStatus()?.instances.find((item) => item.id === id);
    if (!instance) {
      throw new Error(`Instance "${id}" not found`);
    }
    return instance.mode === 'docker' ? this.dockerBackend : this.profileBackend;
  }

  private async backendForId(id: string): Promise<DeploymentBackend> {
    const cached = this.getCachedStatus()?.instances.find((item) => item.id === id);
    if (cached) {
      return cached.mode === 'docker' ? this.dockerBackend : this.profileBackend;
    }

    const refreshed = await this.refresh();
    const instance = refreshed.instances.find((item) => item.id === id);
    if (!instance) {
      throw new Error(`Instance "${id}" not found`);
    }
    return instance.mode === 'docker' ? this.dockerBackend : this.profileBackend;
  }
}
