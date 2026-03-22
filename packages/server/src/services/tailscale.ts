import { execFile } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BASE_TS_PORT = 8800;
const PORT_FILE = 'tailscale-ports.json';

export class TailscaleService {
  private portMap: Map<number, number> = new Map();

  constructor(private fleetDir: string, private hostname: string) {}

  /**
   * Allocate ports for given indices (no-op if already assigned).
   * Saves to port file. Returns full current map.
   */
  allocatePorts(indices: number[]): Map<number, number> {
    for (const index of indices) {
      if (!this.portMap.has(index)) {
        this.portMap.set(index, BASE_TS_PORT + (index - 1));
      }
    }
    this.savePorts();
    return new Map(this.portMap);
  }

  /**
   * Returns "https://{hostname}:{tsPort}" or undefined if index not allocated.
   */
  getUrl(index: number): string | undefined {
    const port = this.portMap.get(index);
    if (port === undefined) return undefined;
    return `https://${this.hostname}:${port}`;
  }

  /**
   * Runs: tailscale serve --bg --https={tsPort} localhost:{gwPort}
   * Then verifies via: tailscale serve status --json
   * Returns the HTTPS URL on success.
   */
  async setup(index: number, gwPort: number): Promise<string> {
    const tsPort = this.portMap.get(index);
    if (tsPort === undefined) {
      throw new Error(`No port allocated for instance ${index}`);
    }

    // Run: tailscale serve --bg --https={tsPort} localhost:{gwPort}
    await execFileAsync('tailscale', ['serve', '--bg', `--https=${tsPort}`, `localhost:${gwPort}`], {});

    // Verify via: tailscale serve status --json
    const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], {});
    let status: any;
    try {
      status = JSON.parse(stdout);
    } catch {
      status = {};
    }

    const key = `${this.hostname}:${tsPort}`;
    const handlers = status?.Web?.[key]?.Handlers;
    if (!handlers) {
      // Teardown silently on failure
      await this.teardown(index);
      throw new Error(
        `TailscaleService.setup: verification failed for instance ${index} (key=${key})`,
      );
    }

    return `https://${this.hostname}:${tsPort}`;
  }

  /**
   * Runs: tailscale serve --https={tsPort} off  (NO --bg flag)
   * Errors are caught and console.error'd, never thrown.
   * No-op if index not in portMap.
   */
  async teardown(index: number): Promise<void> {
    const tsPort = this.portMap.get(index);
    if (tsPort === undefined) return;

    try {
      await execFileAsync('tailscale', ['serve', `--https=${tsPort}`, 'off'], {});
    } catch (err) {
      console.error(`TailscaleService.teardown: error for instance ${index}:`, err);
    }
  }

  /**
   * Reads tailscale-ports.json, rebuilds in-memory map.
   * Removes entries for indices not in the provided instances list.
   * For each instance in list: checks tailscale serve status --json for active rule.
   *   If rule missing: calls setup(index, gwPort) to restore it (errors logged, not thrown).
   */
  async syncAll(instances: { index: number; gwPort: number }[]): Promise<void> {
    // Read ports from file
    this.portMap = this.loadPorts();

    // Build set of active indices
    const activeIndices = new Set(instances.map((i) => i.index));

    // Remove stale entries (indices not in instances list)
    for (const key of [...this.portMap.keys()]) {
      if (!activeIndices.has(key)) {
        this.portMap.delete(key);
      }
    }

    // Check status for all instances
    let status: any = {};
    try {
      const { stdout } = await execFileAsync('tailscale', ['serve', 'status', '--json'], {});
      status = JSON.parse(stdout);
    } catch (err) {
      console.error('TailscaleService.syncAll: failed to get serve status:', err);
    }

    // For each instance, check if rule is active; if not, restore via setup
    for (const { index, gwPort } of instances) {
      const tsPort = this.portMap.get(index);
      if (tsPort === undefined) continue;

      const key = `${this.hostname}:${tsPort}`;
      const hasRule = !!status?.Web?.[key]?.Handlers;

      if (!hasRule) {
        try {
          await this.setup(index, gwPort);
        } catch (err) {
          console.error(`TailscaleService.syncAll: failed to restore instance ${index}:`, err);
        }
      }
    }

    // Persist cleaned-up map
    this.savePorts();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private savePorts(): void {
    const obj: Record<string, number> = {};
    for (const [index, port] of this.portMap) {
      obj[String(index)] = port;
    }
    const path = join(this.fleetDir, PORT_FILE);
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, path);
  }

  private loadPorts(): Map<number, number> {
    const path = join(this.fleetDir, PORT_FILE);
    let raw: Record<string, number>;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return new Map();
    }

    const map = new Map<number, number>();
    for (const [key, port] of Object.entries(raw)) {
      map.set(parseInt(key, 10), port);
    }
    return map;
  }
}
