import { expect, test, type Page } from '@playwright/test';

type Role = 'admin' | 'user';
type Mode = 'docker' | 'profiles' | 'hybrid';
type InstanceRuntime = 'openclaw' | 'hermes';

interface RuntimeCapabilities {
  configEditor: boolean;
  logs: boolean;
  rename: boolean;
  delete: boolean;
  proxyAccess: boolean;
  sessions: boolean;
  plugins: boolean;
  runtimeAdmin: boolean;
}

interface FleetInstance {
  id: string;
  runtime?: InstanceRuntime;
  mode: 'docker' | 'profile';
  runtimeCapabilities?: RuntimeCapabilities;
  status: 'running' | 'stopped' | 'restarting' | 'unhealthy' | 'unknown';
  port: number;
  token: string;
  uptime: number;
  cpu: number;
  memory: { used: number; limit: number };
  disk: { config: number; workspace: number };
  health: 'healthy' | 'unhealthy' | 'starting' | 'none';
  image: string;
  tailscaleUrl?: string;
  profile?: string;
  pid?: number;
}

interface FleetSession {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
}

interface FleetSessionsEntry {
  instanceId: string;
  sessions: FleetSession[];
  error?: string;
}

interface MountOptions {
  role?: Role;
  assignedProfiles?: string[];
  fleetMode: Mode;
  instances: FleetInstance[];
  sessionsData?: FleetSessionsEntry[];
}

interface MountHandles {
  createInstancePayloads: unknown[];
}

const sampleConfig = {
  channels: {
    feishu: {
      enabled: true,
      appId: 'cli_test',
      appSecret: 'top-secret',
      requireMention: true,
      groupPolicy: 'open',
    },
  },
};

const sampleFleetConfig = {
  baseUrl: 'https://api.example.test',
  apiKey: 'configured',
  modelId: 'gpt-5.4',
  baseDir: '/tmp/managed',
  count: 2,
  cpuLimit: '2',
  memLimit: '4g',
  portStep: 20,
  configBase: '/tmp/config',
  workspaceBase: '/tmp/workspace',
  tz: 'UTC',
  openclawImage: 'openclaw:local',
  enableNpmPackages: true,
};

const sampleUsers = [
  { username: 'admin', role: 'admin', assignedProfiles: [] },
  { username: 'alice', role: 'user', assignedProfiles: ['team-alpha'] },
];

const openclawCapabilities: RuntimeCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: true,
  sessions: true,
  plugins: true,
  runtimeAdmin: true,
};

const hermesCapabilities: RuntimeCapabilities = {
  configEditor: true,
  logs: true,
  rename: true,
  delete: true,
  proxyAccess: false,
  sessions: false,
  plugins: false,
  runtimeAdmin: true,
};

function normalizeInstance(instance: FleetInstance): FleetInstance & {
  runtime: InstanceRuntime;
  runtimeCapabilities: RuntimeCapabilities;
} {
  const runtime = instance.runtime ?? 'openclaw';
  return {
    ...instance,
    runtime,
    runtimeCapabilities: instance.runtimeCapabilities
      ?? (runtime === 'hermes' ? hermesCapabilities : openclawCapabilities),
  };
}

async function mountDashboard(page: Page, opts: MountOptions): Promise<MountHandles> {
  const {
    role = 'admin',
    assignedProfiles = [],
    fleetMode,
    instances,
    sessionsData = [],
  } = opts;
  const normalizedInstances = instances.map(normalizeInstance);
  const createInstancePayloads: unknown[] = [];
  await page.setViewportSize({ width: 1440, height: 1600 });

  await page.addInitScript(() => {
    const openedUrls: string[] = [];
    (window as Window & { __openedUrls?: string[] }).__openedUrls = openedUrls;
    window.open = ((url?: string | URL) => {
      openedUrls.push(String(url ?? ''));
      return null;
    }) as typeof window.open;

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          this.onopen?.(new Event('open'));
          this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({
              id: 'log-1',
              line: `connected ${url}`,
              ts: Date.now(),
            }),
          }));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
      }

      addEventListener() {}

      removeEventListener() {}

      dispatchEvent() {
        return true;
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: MockWebSocket,
    });
  });

  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        username: role === 'admin' ? 'admin' : 'alice',
        role,
        assignedProfiles,
      }),
    });
  });

  await page.route('**/api/users', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sampleUsers),
    });
  });

  await page.route('**/api/config/fleet', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sampleFleetConfig),
    });
  });

  await page.route('**/api/fleet', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: fleetMode,
        instances: normalizedInstances,
        totalRunning: normalizedInstances.filter((instance) => instance.status === 'running').length,
        updatedAt: Date.now(),
      }),
    });
  });

  await page.route('**/api/fleet/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        instances: sessionsData,
        updatedAt: Date.now(),
      }),
    });
  });

  await page.route('**/api/fleet/instances', async (route) => {
    if (route.request().method() === 'POST') {
      createInstancePayloads.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(normalizedInstances[0] ?? null),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(normalizedInstances[0] ?? null),
    });
  });

  await page.route('**/api/fleet/*/config', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(sampleConfig),
    });
  });

  await page.route('**/api/fleet/*/devices/pending', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending: [{ requestId: 'req-1', ip: '10.0.0.8' }] }),
    });
  });

  await page.route('**/api/fleet/*/devices/*/approve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/fleet/*/feishu/pairing', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        pending: [{ code: 'PAIR-001', userId: 'u_123' }],
        raw: 'pairing output',
      }),
    });
  });

  await page.route('**/api/fleet/*/feishu/pairing/*/approve', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/fleet/*/plugins/install', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'installed' }) });
  });

  await page.route('**/api/fleet/*/plugins/*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'removed' }) });
  });

  await page.route('**/api/fleet/*/plugins', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workspaceDir: '/tmp/workspace/openclaw-1',
        plugins: [
          {
            id: '@openclaw/feishu',
            name: 'Feishu',
            description: 'Feishu integration',
            version: '1.0.0',
            origin: 'npm',
            status: 'enabled',
            enabled: true,
          },
        ],
      }),
    });
  });

  await page.route('**/api/fleet/*/token/reveal', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'revealed-token' }),
    });
  });

  await page.route('**/api/fleet/scale', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        fleet: {
          mode: fleetMode,
          instances: normalizedInstances,
          totalRunning: normalizedInstances.length,
          updatedAt: Date.now(),
        },
      }),
    });
  });

  await page.route('**/api/fleet/profiles', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(instances[0]),
    });
  });

  await page.route('**/api/fleet/profiles/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/fleet/*/start', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, instance: normalizedInstances[0] }) });
  });
  await page.route('**/api/fleet/*/stop', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, instance: normalizedInstances[0] }) });
  });
  await page.route('**/api/fleet/*/restart', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, instance: normalizedInstances[0] }) });
  });

  await page.goto('/');
  return { createInstancePayloads };
}

test('admin can navigate all admin pages and instance tabs in docker mode', async ({ page }) => {
  const handles = await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-1',
        mode: 'docker',
        status: 'running',
        port: 3101,
        token: 'masked-token',
        uptime: 3600,
        cpu: 14,
        memory: { used: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
      {
        id: 'openclaw-2',
        mode: 'docker',
        status: 'stopped',
        port: 3121,
        token: 'masked-token-2',
        uptime: 0,
        cpu: 0,
        memory: { used: 0, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'none',
        image: 'openclaw:local',
      },
    ],
  });

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Fleet summary, throughput, runtime distribution, and load hotspots.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage Instances' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toBeVisible();

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add Instance' })).toBeVisible();
  await expect(page.locator('.table-shell').getByRole('button', { name: 'Open' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '+ Add Instance' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add Instance' }).click();
  await expect(page.getByRole('button', { name: 'Create OpenClaw Docker' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create OpenClaw Profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Hermes Docker' })).toBeVisible();

  await page.getByRole('button', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add User' })).toBeVisible();
  await expect(page.getByText('alice')).toBeVisible();

  await page.getByRole('button', { name: 'Fleet Config' }).click();
  await expect(page.getByRole('heading', { name: 'Control Plane' })).toBeVisible();
  const fleetConfigPanel = page.locator('section.panel-card').filter({ has: page.getByRole('heading', { name: 'Control Plane' }) });
  await expect(fleetConfigPanel.getByLabel('Base Directory')).toBeVisible();
  await expect(fleetConfigPanel.getByLabel('Docker Image')).toHaveCount(0);
  await expect(fleetConfigPanel.getByText('Workspace Base', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await page.getByRole('button', { name: '+ Add Instance' }).click();
  await page.getByRole('button', { name: 'Create OpenClaw Docker' }).click();
  await expect(page.getByRole('heading', { name: 'Add Docker Instance' })).toBeVisible();
  await expect(page.getByText('Docker Image')).toHaveCount(0);
  await page.getByRole('button', { name: 'Advanced Docker Config' }).click();
  await expect(page.getByLabel('Docker Image')).toHaveValue('openclaw:local');
  await expect(page.getByLabel('CPU Limit')).toHaveValue('2');
  await expect(page.getByLabel('Memory Limit')).toHaveValue('4g');
  await expect(page.getByLabel('Port Step')).toHaveValue('20');
  await expect(page.getByLabel('Enable npm packages')).toBeChecked();
  await page.getByPlaceholder('team-alpha').fill('Team-Delta');
  await page.getByLabel('Docker Image').fill('ghcr.io/acme/openclaw:test');
  await page.getByLabel('CPU Limit').fill('6');
  await page.getByLabel('Memory Limit').fill('12g');
  await page.getByLabel('Port Step').fill('35');
  const enableNpmPackagesCheckbox = page.getByLabel('Enable npm packages');
  await enableNpmPackagesCheckbox.uncheck();
  await page.getByRole('button', { name: 'Create Docker Instance' }).click();
  await expect.poll(() => handles.createInstancePayloads.length).toBe(1);
  expect(handles.createInstancePayloads[0]).toEqual({
    runtime: 'openclaw',
    kind: 'docker',
    name: 'team-delta',
    image: 'ghcr.io/acme/openclaw:test',
    cpuLimit: '6',
    memoryLimit: '12g',
    portStep: 35,
    enableNpmPackages: false,
  });

  await page.getByRole('button', { name: '+ Add Instance' }).click();
  await page.getByRole('button', { name: 'Create Hermes Docker' }).click();
  await expect(page.getByRole('heading', { name: 'Add Hermes Docker Instance' })).toBeVisible();
  await page.getByPlaceholder('team-alpha').fill('Hermes-Lab');
  await page.getByRole('button', { name: 'Create Hermes Docker' }).click();
  await expect.poll(() => handles.createInstancePayloads.length).toBe(2);
  expect(handles.createInstancePayloads[1]).toEqual({
    runtime: 'hermes',
    kind: 'docker',
    name: 'hermes-lab',
  });

  await page.getByRole('button', { name: '+ Add Instance' }).click();
  await page.getByRole('button', { name: 'Create OpenClaw Profile' }).click();
  await expect(page.getByRole('heading', { name: 'Add Profile' })).toBeVisible();
  await expect(page.getByPlaceholder('18789')).toBeVisible();
  await expect(page.getByText('Docker Image')).toHaveCount(0);
  await page.getByPlaceholder('team-alpha').fill('Rescue-Team');
  await page.getByPlaceholder('18789').fill('987');
  await page.getByRole('button', { name: 'Create Profile' }).click();
  await expect.poll(() => handles.createInstancePayloads.length).toBe(3);
  expect(handles.createInstancePayloads[2]).toEqual({
    runtime: 'openclaw',
    kind: 'profile',
    name: 'rescue-team',
    port: 987,
  });

  await page.locator('.table-shell tr', { hasText: 'openclaw-1' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();
  await expect(page.getByText('openclaw:local')).toBeVisible();

  await page.getByRole('button', { name: 'logs' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText(/connected .*\/ws\/logs\/openclaw-1/).first()).toBeVisible();

  await page.getByRole('button', { name: 'config', exact: true }).click();
  await expect(page.getByText('Edit raw instance JSON carefully.')).toBeVisible();

  await page.getByRole('button', { name: 'metrics' }).click();
  await expect(page.getByRole('heading', { name: 'CPU History' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Memory History' })).toBeVisible();

  await page.getByRole('button', { name: 'control ui' }).click();
  await expect(page.getByRole('heading', { name: 'Control UI' })).toBeVisible();
  await expect(page.getByText('10.0.0.8')).toBeVisible();
  await page.getByRole('button', { name: 'Open Control UI' }).click();
  await expect(page.getByText('Opened Control UI in a new tab.')).toBeVisible();

  await page.getByRole('button', { name: 'feishu' }).click();
  await expect(page.getByRole('heading', { name: 'Feishu Channel' })).toBeVisible();
  await expect(page.getByText('PAIR-001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Config' })).toBeVisible();

  await page.getByRole('button', { name: 'plugins' }).click();
  await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible();
  await expect(page.getByText('Feishu integration')).toBeVisible();
  await expect(page.getByText('/tmp/workspace/openclaw-1')).toBeVisible();
});

test('Hermes docker instances hide OpenClaw-only tabs', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'hermes-lab',
        runtime: 'hermes',
        mode: 'docker',
        status: 'running',
        port: 4101,
        token: 'masked-token',
        uptime: 1800,
        cpu: 6,
        memory: { used: 1024 * 1024 * 256, limit: 1024 * 1024 * 1024 },
        disk: { config: 80, workspace: 120 },
        health: 'healthy',
        image: 'ghcr.io/nousresearch/hermes-agent:latest',
      },
    ],
  });

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await page.locator('.table-shell tr', { hasText: 'hermes-lab' }).getByRole('button', { name: 'Open' }).click();
  const tabRow = page.locator('.tab-row');

  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
  await expect(page.getByText('Hermes', { exact: true })).toBeVisible();
  await expect(page.getByText('ghcr.io/nousresearch/hermes-agent:latest')).toBeVisible();
  await expect(tabRow.getByRole('button', { name: 'logs' })).toBeVisible();
  await expect(tabRow.getByRole('button', { name: 'config', exact: true })).toBeVisible();
  await expect(tabRow.getByRole('button', { name: 'metrics' })).toBeVisible();
  await expect(tabRow.getByRole('button', { name: 'activity' })).toHaveCount(0);
  await expect(tabRow.getByRole('button', { name: 'control ui' })).toHaveCount(0);
  await expect(tabRow.getByRole('button', { name: 'feishu' })).toHaveCount(0);
  await expect(tabRow.getByRole('button', { name: 'plugins' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Migrate' })).toHaveCount(0);
});

test('browser back and forward restore manager views and instance tabs', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-1',
        mode: 'docker',
        status: 'running',
        port: 3101,
        token: 'masked-token',
        uptime: 3600,
        cpu: 14,
        memory: { used: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
    ],
  });

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await expect(page).toHaveURL(/\/\?view=instances$/);
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();

  await page.locator('.table-shell tr', { hasText: 'openclaw-1' }).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/\?view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();

  await page.getByRole('button', { name: 'logs' }).click();
  await expect(page).toHaveURL(/\/\?view=instance&id=openclaw-1&tab=logs$/);
  await expect(page.getByText(/connected .*\/ws\/logs\/openclaw-1/).first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/\?view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/\?view=instances$/);
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/\?view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/\?view=instance&id=openclaw-1&tab=logs$/);
  await expect(page.getByText(/connected .*\/ws\/logs\/openclaw-1/).first()).toBeVisible();
});

test('hybrid fleet keeps one shell and shows both instance kinds together', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'team-alpha',
        mode: 'profile',
        status: 'running',
        port: 18789,
        token: 'masked-token',
        uptime: 7200,
        cpu: 7,
        memory: { used: 1024 * 1024 * 256, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
        profile: 'team-alpha',
        pid: 4242,
      },
      {
        id: 'openclaw-7',
        mode: 'docker',
        status: 'running',
        port: 18829,
        token: 'masked-token-2',
        uptime: 3600,
        cpu: 3,
        memory: { used: 1024 * 1024 * 128, limit: 1024 * 1024 * 1024 },
        disk: { config: 50, workspace: 60 },
        health: 'healthy',
        image: 'openclaw:local',
      },
    ],
  });

  await expect(page.getByText('2/2 instances ready')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage Instances' })).toBeVisible();

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await expect(page.getByRole('heading', { name: 'Add Instance' })).toBeVisible();
  await expect(page.locator('.table-shell').getByRole('button', { name: 'Delete' })).toHaveCount(2);
  await expect(page.getByText('Docker')).toBeVisible();
  await expect(page.getByText('Profile')).toBeVisible();

  await page.locator('.table-shell tr', { hasText: 'team-alpha' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
  await expect(page.getByText('PID')).toBeVisible();
  await expect(page.getByText('4242')).toBeVisible();
});

test('activity page defaults to board mode and can toggle to table mode', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-1',
        mode: 'docker',
        status: 'running',
        port: 3101,
        token: 'masked-token',
        uptime: 3600,
        cpu: 14,
        memory: { used: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
      {
        id: 'team-alpha',
        mode: 'profile',
        status: 'running',
        port: 18789,
        token: 'masked-token-2',
        uptime: 7200,
        cpu: 7,
        memory: { used: 1024 * 1024 * 256, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
        profile: 'team-alpha',
        pid: 4242,
      },
    ],
    sessionsData: [
      {
        instanceId: 'openclaw-1',
        sessions: [
          {
            key: 'run-1',
            derivedTitle: 'Running task',
            status: 'running',
            kind: 'chat',
            totalTokens: 1234,
            estimatedCostUsd: 0.45,
            lastMessagePreview: 'Still working',
            updatedAt: Date.now() - 5_000,
          },
        ],
      },
      {
        instanceId: 'team-alpha',
        sessions: [
          {
            key: 'done-1',
            derivedTitle: 'Finished task',
            status: 'done',
            kind: 'job',
            totalTokens: 4321,
            estimatedCostUsd: 0.67,
            lastMessagePreview: 'All complete',
            updatedAt: Date.now() - 15_000,
          },
        ],
      },
    ],
  });

  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Board view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Running' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'openclaw-1 Running task run-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'team-alpha Finished task done-1' })).toBeVisible();

  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('button', { name: 'Table view' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Instance' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Running task' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Finished task' })).toBeVisible();
});

test('activity page shows per-instance session fetch errors in the board strip', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-1',
        mode: 'docker',
        status: 'running',
        port: 3101,
        token: 'masked-token',
        uptime: 3600,
        cpu: 14,
        memory: { used: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
      {
        id: 'team-beta',
        mode: 'profile',
        status: 'running',
        port: 18790,
        token: 'masked-token-2',
        uptime: 1200,
        cpu: 4,
        memory: { used: 1024 * 1024 * 128, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
        profile: 'team-beta',
        pid: 5252,
      },
    ],
    sessionsData: [
      {
        instanceId: 'openclaw-1',
        sessions: [
          {
            key: 'run-1',
            derivedTitle: 'Healthy session',
            status: 'running',
            kind: 'chat',
            totalTokens: 250,
            estimatedCostUsd: 0.12,
            lastMessagePreview: 'Working normally',
            updatedAt: Date.now() - 10_000,
          },
        ],
      },
      {
        instanceId: 'team-beta',
        error: 'Instance request failed',
        sessions: [],
      },
    ],
  });

  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByText('team-beta: Instance request failed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'openclaw-1 Healthy session run-1' })).toBeVisible();
});

test('non-admin sidebar instance list scrolls when many assigned instances are available', async ({ page }) => {
  const manyInstances = Array.from({ length: 20 }, (_, index) => ({
    id: `team-${String(index + 1).padStart(2, '0')}`,
    mode: index % 2 === 0 ? 'docker' : ('profile' as const),
    status: index % 3 === 0 ? 'running' : 'stopped',
    port: 18789 + index,
    token: `masked-token-${index}`,
    uptime: 0,
    cpu: index % 3 === 0 ? 1 : 0,
    memory: { used: 0, limit: 1024 * 1024 * 1024 },
    disk: { config: 100, workspace: 200 },
    health: 'healthy' as const,
    image: 'openclaw:local',
  }));

  await mountDashboard(page, {
    role: 'user',
    assignedProfiles: manyInstances.map((instance) => instance.id),
    fleetMode: 'hybrid',
    instances: manyInstances,
  });
  await page.setViewportSize({ width: 1440, height: 700 });

  const sidebarNav = page.locator('.sidebar-nav');
  const { scrollHeight, clientHeight } = await sidebarNav.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));

  expect(scrollHeight).toBeGreaterThan(clientHeight);

  const firstItem = page.locator('.sidebar-nav .sidebar-item').first();
  const lastItem = page.locator('.sidebar-nav .sidebar-item').last();

  await sidebarNav.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastItem).toBeVisible();

  await sidebarNav.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(firstItem).toBeVisible();
});

test('non-admin can access the account page and assigned instance only', async ({ page }) => {
  await mountDashboard(page, {
    role: 'user',
    assignedProfiles: ['team-alpha'],
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'team-alpha',
        mode: 'profile',
        status: 'running',
        port: 18789,
        token: 'masked-token',
        uptime: 7200,
        cpu: 7,
        memory: { used: 1024 * 1024 * 256, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
        profile: 'team-alpha',
        pid: 4242,
      },
    ],
  });

  await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toHaveCount(0);
  await expect(page.getByText('You currently have 1 assigned instance and can jump back into them from here.')).toBeVisible();
  await expect(page.locator('.profile-list').getByRole('button', { name: /^team-alpha/i })).toBeVisible();

  await page.locator('.profile-list').getByRole('button', { name: /^team-alpha/i }).click();
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
});
