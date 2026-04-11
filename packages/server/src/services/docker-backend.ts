// packages/server/src/services/docker-backend.ts
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { DeploymentBackend, LogHandle, CreateInstanceOpts } from './backend.js';
import type { DockerService } from './docker.js';
import { FleetConfigService } from './fleet-config.js';
import { provisionDockerInstance } from './docker-instance-provisioning.js';
import type { TailscaleService } from './tailscale.js';
import { getDirectorySize } from './dir-utils.js';
import type { FleetConfig, FleetInstance, FleetStatus } from '../types.js';
import { MANAGED_INSTANCE_ID_RE } from '../validate.js';

const execFileAsync = promisify(execFile);
export const BASE_GW_PORT = 18789;

export class DockerBackend implements DeploymentBackend {
  private cache: FleetStatus | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private locks = new Map<string, boolean>();

  constructor(
    private docker: DockerService,
    private fleetConfig: FleetConfigService,
    private fleetDir: string,
    private tailscale: TailscaleService | null,
    private tailscaleHostname: string | null,
    private log?: FastifyBaseLogger,
  ) {}

  async initialize(): Promise<void> {
    if (this.tailscale) {
      const containers = await this.docker.listFleetContainers().catch(() => []);
      const defaultPortStep = this.fleetConfig.readFleetConfig().portStep;
      const instances = containers
        .filter((container) => container.index !== undefined)
        .map((container) => {
          const index = container.index!;
          const portStep = this.resolveInstancePortStep(container.name, defaultPortStep);
          const gwPort = BASE_GW_PORT + (index - 1) * portStep;
          return { index, gwPort };
        });
      await this.tailscale.syncAll(instances);
    }
    void this.refresh();
    this.interval = setInterval(() => { void this.refresh(); }, 5000);
  }

  async shutdown(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getCachedStatus(): FleetStatus | null {
    return this.cache;
  }

  async refresh(): Promise<FleetStatus> {
    const containers = await this.docker.listFleetContainers();
    const tokens = this.fleetConfig.readTokens();
    const config = this.fleetConfig.readFleetConfig();

    const instances: FleetInstance[] = await Promise.all(
      containers.map((container) => this.buildInstanceFromContainer(container, config, tokens)),
    );

    // Override disk from Docker volume usage (best effort)
    try {
      const diskUsage = await this.docker.getDiskUsage();
      for (const instance of instances) {
        for (const [name, size] of Object.entries(diskUsage)) {
          if (instance.index !== undefined) {
            if (name.includes(`instances/${instance.index}`) || name.includes(`config/${instance.index}`)) {
              instance.disk.config = size;
            }
            if (name.includes(`workspaces/${instance.index}`)) {
              instance.disk.workspace = size;
            }
          }
        }
      }
    } catch {
      // best effort
    }

    const status: FleetStatus = {
      instances,
      totalRunning: instances.filter((i) => i.status === 'running').length,
      updatedAt: Date.now(),
    };

    this.cache = status;
    return status;
  }

  async start(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      await this.docker.startContainer(id);
    });
  }

  async stop(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      await this.docker.stopContainer(id);
    });
  }

  async restart(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      await this.docker.restartContainer(id);
    });
  }

  async createInstance(opts: CreateInstanceOpts): Promise<FleetInstance> {
    const containers = await this.docker.listFleetContainers();
    const usedIndexes = containers
      .map((container) => container.index)
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b);
    const newIndex = nextAvailableIndex(usedIndexes);
    const name = opts.name?.trim() || `openclaw-${newIndex}`;

    if (!MANAGED_INSTANCE_ID_RE.test(name)) {
      throw new Error('name must be lowercase alphanumeric with hyphens');
    }
    if (containers.some((container) => container.name === name)) {
      throw new Error(`Instance "${name}" already exists`);
    }

    const config = this.fleetConfig.readFleetConfig();
    const resolvedPortStep = opts.portStep ?? config.portStep;
    const resolvedImage = opts.image ?? config.openclawImage;
    const resolvedCpuLimit = opts.cpuLimit ?? config.cpuLimit;
    const resolvedMemoryLimit = opts.memoryLimit ?? config.memLimit;
    const resolvedEnableNpmPackages = opts.enableNpmPackages ?? config.enableNpmPackages;
    const vars = {
      ...this.fleetConfig.readFleetEnvRaw(),
      ...(opts.apiKey ? { API_KEY: opts.apiKey } : {}),
    };
    const tokens = this.fleetConfig.readTokens();
    const token = tokens[newIndex] ?? randomToken();
    this.fleetConfig.writeTokens({ ...tokens, [newIndex]: token });
    this.fleetConfig.ensureFleetDirectories();

    const portMap = this.tailscale?.allocatePorts([newIndex]) ?? new Map<number, number>();
    provisionDockerInstance({
      instanceId: name,
      index: newIndex,
      portStep: resolvedPortStep,
      configDir: this.fleetConfig.getDockerConfigDir(name),
      workspaceDir: this.fleetConfig.getDockerWorkspaceDir(name),
      vars,
      token,
      tailscaleConfig: this.tailscaleHostname ? { hostname: this.tailscaleHostname, portMap } : undefined,
      configOverride: opts.config,
    });
    this.fleetConfig.writeInstanceMeta(name, { portStep: resolvedPortStep });

    await this.docker.createManagedContainer({
      name,
      index: newIndex,
      image: resolvedImage,
      gatewayPort: BASE_GW_PORT + (newIndex - 1) * resolvedPortStep,
      token,
      timezone: config.tz,
      configDir: this.fleetConfig.getDockerConfigDir(name),
      workspaceDir: this.fleetConfig.getDockerWorkspaceDir(name),
      npmDir: resolvedEnableNpmPackages ? join(this.fleetConfig.getDockerConfigDir(name), '.npm') : undefined,
      cpuLimit: resolvedCpuLimit,
      memLimit: resolvedMemoryLimit,
    });
    if (!resolvedEnableNpmPackages) {
      this.log?.warn({ instanceId: name }, 'npm packages mount is disabled — plugin installation will fail for this instance');
    }

    if (this.tailscale) {
      const gwPort = BASE_GW_PORT + (newIndex - 1) * resolvedPortStep;
      try {
        await this.tailscale.setup(newIndex, gwPort);
      } catch (err) {
        this.log?.error({ err, newIndex }, 'Tailscale setup failed for new instance');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((i) => i.id === name);
    if (!instance) throw new Error(`Instance "${name}" not found after creation`);
    return instance;
  }

  async removeInstance(id: string): Promise<void> {
    await this.withInstanceLock(id, async () => {
      const container = await this.findContainer(id);
      if (!container) return;

      if (container.index !== undefined) {
        await this.tailscale?.teardown(container.index);
      }

      try {
        await this.docker.removeContainer(id);
      } catch {
        // already removed
      }
      await this.refresh();
    });
  }

  async renameInstance(id: string, nextName: string): Promise<FleetInstance> {
    if (id === nextName) {
      throw new Error('Cannot rename an instance to the same name');
    }
    if (!MANAGED_INSTANCE_ID_RE.test(nextName)) {
      throw new Error('name must be lowercase alphanumeric with hyphens');
    }
    if (this.locks.get(id)) {
      throw new Error(`Instance "${id}" is locked`);
    }
    if (this.locks.get(nextName)) {
      throw new Error(`Instance "${nextName}" is locked`);
    }

    this.locks.set(id, true);
    let lockId = id;

    try {
      const containers = await this.docker.listFleetContainers();
      const source = containers.find((container) => container.name === id);
      if (!source) {
        throw new Error(`Instance "${id}" not found`);
      }
      if (containers.some((container) => container.name === nextName)) {
        throw new Error(`Instance "${nextName}" already exists`);
      }

      const inspection = await this.docker.inspectContainer(id).catch(() => ({
        status: source.state,
        health: 'none',
        image: 'unknown',
        uptime: 0,
      }));
      if (this.mapStatus(inspection.status) !== 'stopped') {
        throw new Error(`Instance "${id}" must be stopped before it can be renamed`);
      }

      const currentRoot = this.fleetConfig.getDockerInstanceRoot(id);
      const nextRoot = this.fleetConfig.getDockerInstanceRoot(nextName);
      const nextConfigDir = this.fleetConfig.getDockerConfigDir(nextName);
      const nextWorkspaceDir = this.fleetConfig.getDockerWorkspaceDir(nextName);
      renameSync(currentRoot, nextRoot);
      try {
        await this.docker.recreateStoppedManagedContainer({
          currentName: id,
          nextName,
          configDir: nextConfigDir,
          workspaceDir: nextWorkspaceDir,
          npmDir: join(nextConfigDir, '.npm'),
        });
      } catch (error) {
        renameSync(nextRoot, currentRoot);
        throw error;
      }

      this.locks.delete(id);
      this.locks.set(nextName, true);
      lockId = nextName;

      return await this.resolveRenamedInstance(id, nextName, {
        index: source.index,
        state: inspection.status,
      });
    } finally {
      this.locks.set(lockId, false);
    }
  }

  streamLogs(id: string, onData: (line: string) => void): LogHandle {
    let logStream: import('node:stream').Readable | undefined;
    (async () => {
      logStream = await this.docker.getContainerLogs(id, { follow: true, tail: 100 }) as import('node:stream').Readable;
      logStream.on('data', (chunk: Buffer) => {
        for (const line of this.demuxDockerChunk(chunk)) {
          onData(line);
        }
      });
    })().catch((err) => this.log?.error({ err, id }, 'streamLogs failed'));
    return { stop: () => logStream?.destroy() };
  }

  streamAllLogs(onData: (id: string, line: string) => void): LogHandle {
    const streams: import('node:stream').Readable[] = [];
    (async () => {
      const containers = await this.docker.listFleetContainers();
      for (const container of containers) {
        try {
          const logStream = await this.docker.getContainerLogs(
            container.name,
            { follow: true, tail: 20 },
          ) as import('node:stream').Readable;
          streams.push(logStream);
          logStream.on('data', (chunk: Buffer) => {
            for (const line of this.demuxDockerChunk(chunk)) {
              onData(container.name, line);
            }
          });
        } catch {
          // best effort per container
        }
      }
    })().catch((err) => this.log?.error({ err }, 'streamAllLogs failed'));
    return { stop: () => { for (const s of streams) s.destroy(); } };
  }

  async execInstanceCommand(id: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('docker', ['exec', id, 'node', 'dist/index.js', ...args]);
    return stdout;
  }

  async revealToken(id: string): Promise<string> {
    const index = await this.resolveInstanceIndex(id);
    const token = this.fleetConfig.readTokens()[index];
    if (!token) throw new Error(`Token not found for ${id}`);
    return token;
  }

  async readInstanceConfig(id: string): Promise<object> {
    return this.fleetConfig.readInstanceConfig(id) as object;
  }

  async writeInstanceConfig(id: string, config: object): Promise<void> {
    this.fleetConfig.writeInstanceConfig(id, config);
  }

  getDockerConfigDir(instanceId: string): string {
    return this.fleetConfig.getDockerConfigDir(instanceId);
  }

  getDockerWorkspaceDir(instanceId: string): string {
    return this.fleetConfig.getDockerWorkspaceDir(instanceId);
  }

  async createInstanceFromMigration(opts: {
    name: string;
    workspaceDir: string;
    token: string;
  }): Promise<FleetInstance & { tailscaleWarning?: string }> {
    const containers = await this.docker.listFleetContainers();
    if (containers.some((container) => container.name === opts.name)) {
      throw new Error(`Instance "${opts.name}" already exists`);
    }

    const usedIndexes = containers
      .map((container) => container.index)
      .filter((index): index is number => index !== undefined)
      .sort((left, right) => left - right);
    const newIndex = nextAvailableIndex(usedIndexes);

    const config = this.fleetConfig.readFleetConfig();
    const resolvedPortStep = config.portStep;
    const resolvedEnableNpmPackages = config.enableNpmPackages;
    const vars = this.fleetConfig.readFleetEnvRaw();

    const tokens = this.fleetConfig.readTokens();
    this.fleetConfig.writeTokens({ ...tokens, [newIndex]: opts.token });
    this.fleetConfig.ensureFleetDirectories();

    const configDir = this.fleetConfig.getDockerConfigDir(opts.name);
    mkdirSync(configDir, { recursive: true });
    mkdirSync(opts.workspaceDir, { recursive: true });

    const gatewayPort = BASE_GW_PORT + (newIndex - 1) * resolvedPortStep;
    const openclawConfig: Record<string, unknown> = {
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: opts.token },
        controlUi: {
          allowedOrigins: [
            `http://127.0.0.1:${gatewayPort}`,
            `http://localhost:${gatewayPort}`,
          ],
        },
      },
      agents: {
        defaults: { workspace: '/home/node/.openclaw/workspace' },
      },
    };

    const baseUrl = vars.BASE_URL ?? '';
    const apiKey = vars.API_KEY ?? '';
    const modelId = vars.MODEL_ID ?? '';
    if (baseUrl && modelId) {
      openclawConfig.models = {
        mode: 'merge',
        providers: {
          default: {
            baseUrl,
            apiKey,
            api: 'openai-completions',
            models: [{ id: modelId, name: modelId }],
          },
        },
      };
    }

    if (this.tailscale && this.tailscaleHostname) {
      const portMap = this.tailscale.allocatePorts([newIndex]);
      const tsPort = portMap.get(newIndex);
      if (tsPort !== undefined) {
        const gateway = openclawConfig.gateway as Record<string, unknown>;
        const auth = gateway.auth as Record<string, unknown>;
        auth.allowTailscale = true;
        const controlUi = gateway.controlUi as Record<string, unknown>;
        controlUi.allowInsecureAuth = true;
        (controlUi.allowedOrigins as string[]).push(`https://${this.tailscaleHostname}:${tsPort}`);
      }
    }

    const configFile = join(configDir, 'openclaw.json');
    writeFileSync(configFile, JSON.stringify(openclawConfig, null, 2) + '\n');
    this.fleetConfig.writeInstanceMeta(opts.name, { portStep: resolvedPortStep });

    await this.docker.createManagedContainer({
      name: opts.name,
      index: newIndex,
      image: config.openclawImage,
      gatewayPort,
      token: opts.token,
      timezone: config.tz,
      configDir,
      workspaceDir: opts.workspaceDir,
      npmDir: resolvedEnableNpmPackages ? join(configDir, '.npm') : undefined,
      cpuLimit: config.cpuLimit,
      memLimit: config.memLimit,
    });

    let tailscaleWarning: string | undefined;
    if (this.tailscale) {
      try {
        await this.tailscale.setup(newIndex, gatewayPort);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tailscaleWarning = `Tailscale setup failed: ${message}`;
        this.log?.error({ err, newIndex }, 'Tailscale setup failed during migration');
      }
    }

    const status = await this.refresh();
    const instance = status.instances.find((item) => item.id === opts.name);
    if (!instance) throw new Error(`Instance "${opts.name}" not found after migration`);
    return tailscaleWarning ? { ...instance, tailscaleWarning } : instance;
  }
  private mapStatus(status: string): FleetInstance['status'] {
    if (status === 'running') return 'running';
    if (status === 'restarting') return 'restarting';
    if (status === 'exited' || status === 'dead' || status === 'created') return 'stopped';
    if (status === 'unhealthy') return 'unhealthy';
    return 'unknown';
  }

  private mapHealth(health: string): FleetInstance['health'] {
    if (health === 'healthy') return 'healthy';
    if (health === 'unhealthy') return 'unhealthy';
    if (health === 'starting') return 'starting';
    return 'none';
  }

  private resolveInstancePortStep(instanceId: string, fallback: number): number {
    // Prefer the dedicated meta file (new path).
    const meta = this.fleetConfig.readInstanceMeta(instanceId);
    const metaPortStep = meta.portStep;
    if (typeof metaPortStep === 'number' && Number.isFinite(metaPortStep) && metaPortStep > 0) {
      return metaPortStep;
    }
    // Fall back to legacy clawFleet key in openclaw.json.
    try {
      const config = this.fleetConfig.readInstanceConfig(instanceId) as Record<string, unknown>;
      const clawFleet = config.clawFleet as Record<string, unknown> | undefined;
      const portStep = clawFleet?.portStep;
      if (typeof portStep === 'number' && Number.isFinite(portStep) && portStep > 0) {
        return portStep;
      }
    } catch {
      // Instance may not have per-instance metadata yet.
    }
    return fallback;
  }

  private demuxDockerChunk(chunk: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset + 8 <= chunk.length) {
      const size = chunk.readUInt32BE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > chunk.length) break;
      const text = chunk.toString('utf-8', start, end).trim();
      if (text) lines.push(...text.split('\n').map((l) => l.trim()).filter(Boolean));
      offset = end;
    }
    if (lines.length === 0) {
      const fallback = chunk.toString('utf-8').trim();
      if (fallback) lines.push(...fallback.split('\n').map((l) => l.trim()).filter(Boolean));
    }
    return lines;
  }

  private async resolveInstanceIndex(id: string): Promise<number> {
    const container = await this.findContainer(id);
    if (!container?.index) {
      throw new Error(`Instance "${id}" not found`);
    }
    return container.index;
  }

  private async findContainer(id: string) {
    const containers = await this.docker.listFleetContainers();
    return containers.find((container) => container.name === id);
  }

  private async withInstanceLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.locks.get(id)) {
      throw new Error(`Instance "${id}" is locked`);
    }
    this.locks.set(id, true);
    try {
      return await fn();
    } finally {
      this.locks.set(id, false);
    }
  }

  private async buildInstanceFromContainer(
    container: { name: string; state: string; index?: number },
    config: FleetConfig,
    tokens: Record<number, string>,
  ): Promise<FleetInstance> {
    const index = container.index;
    const portStep = this.resolveInstancePortStep(container.name, config.portStep);
    const [stats, inspection] = await Promise.all([
      this.docker.getContainerStats(container.name).catch(() => ({
        cpu: 0,
        memory: { used: 0, limit: 0 },
      })),
      this.docker.inspectContainer(container.name).catch(() => ({
        status: container.state,
        health: 'none',
        image: 'unknown',
        uptime: 0,
      })),
    ]);

    return {
      id: container.name,
      mode: 'docker',
      index,
      status: this.mapStatus(inspection.status),
      port: index !== undefined ? BASE_GW_PORT + (index - 1) * portStep : 0,
      token: index !== undefined ? FleetConfigService.maskToken(tokens[index] ?? '') : '***',
      tailscaleUrl: index !== undefined ? this.tailscale?.getUrl(index) ?? undefined : undefined,
      uptime: inspection.uptime,
      cpu: stats.cpu,
      memory: stats.memory,
      disk: {
        config: await getDirectorySize(this.fleetConfig.getDockerConfigDir(container.name)),
        workspace: await getDirectorySize(this.fleetConfig.getDockerWorkspaceDir(container.name)),
      },
      health: this.mapHealth(inspection.health),
      image: inspection.image,
    };
  }

  private async resolveRenamedInstance(
    previousId: string,
    nextName: string,
    fallbackContainer: { index?: number; state: string },
  ): Promise<FleetInstance> {
    try {
      const status = await this.refresh();
      const renamed = status.instances.find((instance) => instance.id === nextName);
      if (renamed) {
        return renamed;
      }
      this.log?.warn({ instanceId: previousId, nextName }, 'Renamed Docker instance missing from refresh; using fallback instance');
    } catch (error) {
      this.log?.warn({ err: error, instanceId: previousId, nextName }, 'Failed to refresh renamed Docker instance; using fallback instance');
    }

    const fallback = await this.buildInstanceFromContainer(
      { name: nextName, state: fallbackContainer.state, index: fallbackContainer.index },
      this.fleetConfig.readFleetConfig(),
      this.fleetConfig.readTokens(),
    );
    this.upsertCachedInstance(previousId, fallback);
    return fallback;
  }

  private upsertCachedInstance(previousId: string, instance: FleetInstance): void {
    if (!this.cache) return;
    const instances = this.cache.instances
      .filter((item) => item.id !== previousId && item.id !== instance.id)
      .concat(instance)
      .sort((left, right) => left.id.localeCompare(right.id));

    this.cache = {
      instances,
      totalRunning: instances.filter((item) => item.status === 'running').length,
      updatedAt: Date.now(),
    };
  }
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}

function nextAvailableIndex(usedIndexes: number[]): number {
  let candidate = 1;
  for (const index of usedIndexes) {
    if (index === candidate) candidate += 1;
  }
  return candidate;
}
