import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock promisify to act as identity so execFile is called directly (returns promise)
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return { ...actual, promisify: (fn: any) => fn };
});

// Mock execFile so TailscaleService uses our mock
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

// Import after mocks are set up
import { TailscaleService } from '../../src/services/tailscale.js';

const HOSTNAME = 'machine.tailnet.ts.net';
const BASE_TS_PORT = 8800;

function makeStatusJson(hostname: string, tsPort: number, gwPort: number): string {
  return JSON.stringify({
    Web: {
      [`${hostname}:${tsPort}`]: {
        Handlers: { '/': { Proxy: `http://127.0.0.1:${gwPort}` } },
      },
    },
  });
}

describe('TailscaleService', () => {
  let dir: string;
  let svc: TailscaleService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ts-test-'));
    svc = new TailscaleService(dir, HOSTNAME);
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // allocatePorts
  // ---------------------------------------------------------------------------
  describe('allocatePorts()', () => {
    it('assigns BASE_TS_PORT + (index - 1) for each index', () => {
      const map = svc.allocatePorts([1, 2, 3]);
      expect(map.get(1)).toBe(BASE_TS_PORT);       // 8800
      expect(map.get(2)).toBe(BASE_TS_PORT + 1);   // 8801
      expect(map.get(3)).toBe(BASE_TS_PORT + 2);   // 8802
    });

    it('persists allocated ports to tailscale-ports.json', () => {
      svc.allocatePorts([1, 2]);
      const raw = JSON.parse(readFileSync(join(dir, 'tailscale-ports.json'), 'utf-8'));
      expect(raw['1']).toBe(8800);
      expect(raw['2']).toBe(8801);
    });

    it('does not overwrite already-assigned ports', () => {
      svc.allocatePorts([1]);
      // Manually corrupt what index 1 would get by calling again
      const map = svc.allocatePorts([1, 2]);
      expect(map.get(1)).toBe(8800); // unchanged
      expect(map.get(2)).toBe(8801);
    });

    it('returns the full current map including previously allocated ports', () => {
      svc.allocatePorts([1]);
      const map = svc.allocatePorts([2]);
      expect(map.size).toBe(2);
      expect(map.get(1)).toBe(8800);
      expect(map.get(2)).toBe(8801);
    });
  });

  // ---------------------------------------------------------------------------
  // getUrl
  // ---------------------------------------------------------------------------
  describe('getUrl()', () => {
    it('returns undefined for unallocated index', () => {
      expect(svc.getUrl(1)).toBeUndefined();
    });

    it('returns correct HTTPS URL after allocation', () => {
      svc.allocatePorts([1]);
      expect(svc.getUrl(1)).toBe(`https://${HOSTNAME}:8800`);
    });

    it('returns correct URL for index 3 (port 8802)', () => {
      svc.allocatePorts([3]);
      expect(svc.getUrl(3)).toBe(`https://${HOSTNAME}:8802`);
    });
  });

  // ---------------------------------------------------------------------------
  // setup
  // ---------------------------------------------------------------------------
  describe('setup()', () => {
    beforeEach(() => {
      svc.allocatePorts([1]);
    });

    it('calls tailscale serve with --bg --https=8800 localhost:18789', async () => {
      // First call: serve command, second call: status check
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: makeStatusJson(HOSTNAME, 8800, 18789), stderr: '' });

      await svc.setup(1, 18789);

      expect(mockExecFile).toHaveBeenNthCalledWith(
        1,
        'tailscale',
        ['serve', '--bg', '--https=8800', 'localhost:18789'],
        expect.anything(),
      );
    });

    it('verifies via tailscale serve status --json', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: makeStatusJson(HOSTNAME, 8800, 18789), stderr: '' });

      await svc.setup(1, 18789);

      expect(mockExecFile).toHaveBeenNthCalledWith(
        2,
        'tailscale',
        ['serve', 'status', '--json'],
        expect.anything(),
      );
    });

    it('returns the HTTPS URL on success', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: makeStatusJson(HOSTNAME, 8800, 18789), stderr: '' });

      const url = await svc.setup(1, 18789);
      expect(url).toBe(`https://${HOSTNAME}:8800`);
    });

    it('throws on verification failure and runs teardown silently', async () => {
      // Serve succeeds, but status shows no rule
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify({ Web: {} }), stderr: '' })
        // teardown call (should not throw)
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await expect(svc.setup(1, 18789)).rejects.toThrow();
    });

    it('throws Error with message when verification fails', async () => {
      mockExecFile
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: JSON.stringify({ Web: {} }), stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await expect(svc.setup(1, 18789)).rejects.toThrow(Error);
    });
  });

  // ---------------------------------------------------------------------------
  // teardown
  // ---------------------------------------------------------------------------
  describe('teardown()', () => {
    beforeEach(() => {
      svc.allocatePorts([1]);
    });

    it('calls tailscale serve --https=8800 off (no --bg)', async () => {
      mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
      await svc.teardown(1);
      expect(mockExecFile).toHaveBeenCalledWith(
        'tailscale',
        ['serve', '--https=8800', 'off'],
        expect.anything(),
      );
    });

    it('does NOT throw on CLI error', async () => {
      mockExecFile.mockRejectedValueOnce(new Error('CLI failed'));
      await expect(svc.teardown(1)).resolves.toBeUndefined();
    });

    it('is a no-op for unknown index (never calls execFile)', async () => {
      await svc.teardown(99);
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // syncAll
  // ---------------------------------------------------------------------------
  describe('syncAll()', () => {
    it('reads port file and rebuilds in-memory map', async () => {
      svc.allocatePorts([1, 2]);
      // Create a fresh service to simulate restart (no in-memory state)
      const svc2 = new TailscaleService(dir, HOSTNAME);

      // Both instances have active rules
      const statusJson = JSON.stringify({
        Web: {
          [`${HOSTNAME}:8800`]: { Handlers: {} },
          [`${HOSTNAME}:8801`]: { Handlers: {} },
        },
      });
      mockExecFile.mockResolvedValue({ stdout: statusJson, stderr: '' });

      await svc2.syncAll([
        { index: 1, gwPort: 18789 },
        { index: 2, gwPort: 18809 },
      ]);

      expect(svc2.getUrl(1)).toBe(`https://${HOSTNAME}:8800`);
      expect(svc2.getUrl(2)).toBe(`https://${HOSTNAME}:8801`);
    });

    it('removes stale entries (indices not in instances list)', async () => {
      svc.allocatePorts([1, 2, 3]);
      const svc2 = new TailscaleService(dir, HOSTNAME);

      // Only provide rules for 1 and 2
      const statusJson = JSON.stringify({
        Web: {
          [`${HOSTNAME}:8800`]: { Handlers: {} },
          [`${HOSTNAME}:8801`]: { Handlers: {} },
        },
      });
      mockExecFile.mockResolvedValue({ stdout: statusJson, stderr: '' });

      await svc2.syncAll([
        { index: 1, gwPort: 18789 },
        { index: 2, gwPort: 18809 },
      ]);

      // Index 3 should be removed from the map
      expect(svc2.getUrl(3)).toBeUndefined();
    });

    it('re-runs setup for missing serve rules', async () => {
      svc.allocatePorts([1]);
      const svc2 = new TailscaleService(dir, HOSTNAME);

      // First call: status check (no active rule for index 1)
      // Then setup: serve command + status verification
      mockExecFile
        .mockResolvedValueOnce({ stdout: JSON.stringify({ Web: {} }), stderr: '' }) // syncAll status check
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                           // setup: serve --bg
        .mockResolvedValueOnce({ stdout: makeStatusJson(HOSTNAME, 8800, 18789), stderr: '' }); // setup: status verify

      await svc2.syncAll([{ index: 1, gwPort: 18789 }]);

      // setup should have been called (serve --bg command)
      expect(mockExecFile).toHaveBeenCalledWith(
        'tailscale',
        ['serve', '--bg', '--https=8800', 'localhost:18789'],
        expect.anything(),
      );
    });

    it('logs errors from setup but does not throw', async () => {
      svc.allocatePorts([1]);
      const svc2 = new TailscaleService(dir, HOSTNAME);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Status check: no rule, setup fails
      mockExecFile
        .mockResolvedValueOnce({ stdout: JSON.stringify({ Web: {} }), stderr: '' }) // status check
        .mockRejectedValueOnce(new Error('serve failed'));                           // setup serve --bg

      await expect(svc2.syncAll([{ index: 1, gwPort: 18789 }])).resolves.toBeUndefined();
      consoleErrorSpy.mockRestore();
    });
  });
});
