import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

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
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  kind?: string;
  model?: string;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
}

interface FleetSessionsEntry {
  instanceId: string;
  sessions: FleetSession[];
  error?: string;
}

const screenshotsDir = path.resolve('docs/guides/screenshots');
const sampleFleetConfig = {
  baseUrl: 'https://api.example.test',
  apiKey: 'configured',
  modelId: 'gpt-5.4',
  baseDir: '/tmp/managed',
  count: 3,
  cpuLimit: '2',
  memLimit: '4g',
  portStep: 20,
  configBase: '/tmp/config',
  workspaceBase: '/tmp/workspace',
  tz: 'UTC',
  openclawImage: 'openclaw:local',
  enableNpmPackages: true,
};

const sampleConfig = {
  channels: {
    feishu: {
      enabled: true,
      appId: 'cli_liveops',
      appSecret: 'top-secret',
      requireMention: true,
      groupPolicy: 'allowlist',
    },
  },
};

const sampleUsers = [
  { username: 'admin', role: 'admin', assignedProfiles: [] },
  { username: 'alice', role: 'user', assignedProfiles: ['team-alpha'] },
  { username: 'bob', role: 'user', assignedProfiles: ['openclaw-1'] },
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

const instances: FleetInstance[] = [
  {
    id: 'openclaw-1',
    mode: 'docker',
    status: 'running',
    port: 3101,
    token: 'masked-token-1',
    uptime: 19_800,
    cpu: 28.4,
    memory: { used: 1024 * 1024 * 850, limit: 1024 * 1024 * 2048 },
    disk: { config: 1024 * 1024 * 48, workspace: 1024 * 1024 * 720 },
    health: 'healthy',
    image: 'openclaw:local',
  },
  {
    id: 'team-alpha',
    mode: 'profile',
    status: 'running',
    port: 18789,
    token: 'masked-token-2',
    uptime: 8_100,
    cpu: 11.2,
    memory: { used: 1024 * 1024 * 420, limit: 1024 * 1024 * 1024 },
    disk: { config: 1024 * 1024 * 31, workspace: 1024 * 1024 * 388 },
    health: 'healthy',
    image: 'openclaw:local',
    profile: 'team-alpha',
    pid: 4242,
  },
  {
    id: 'hermes-lab',
    runtime: 'hermes',
    mode: 'docker',
    status: 'stopped',
    port: 4101,
    token: 'masked-token-3',
    uptime: 0,
    cpu: 0,
    memory: { used: 0, limit: 1024 * 1024 * 1024 },
    disk: { config: 1024 * 1024 * 20, workspace: 1024 * 1024 * 94 },
    health: 'none',
    image: 'ghcr.io/nousresearch/hermes-agent:latest',
  },
];

const sessionsData: FleetSessionsEntry[] = [
  {
    instanceId: 'openclaw-1',
    sessions: [
      {
        key: 'sess-run-1',
        derivedTitle: 'Live support escalation',
        status: 'running',
        kind: 'chat',
        model: 'gpt-5.4',
        totalTokens: 15_420,
        estimatedCostUsd: 2.31,
        lastMessagePreview: 'Collecting the last stack traces before patching.',
        updatedAt: Date.now() - 30_000,
      },
      {
        key: 'sess-fail-1',
        derivedTitle: 'Deploy canary validation',
        status: 'failed',
        kind: 'job',
        model: 'gpt-5.4-mini',
        totalTokens: 6_208,
        estimatedCostUsd: 0.48,
        lastMessagePreview: 'Canary failed health checks after rollout.',
        updatedAt: Date.now() - 45 * 60 * 1000,
      },
    ],
  },
  {
    instanceId: 'team-alpha',
    sessions: [
      {
        key: 'sess-done-1',
        derivedTitle: 'Customer onboarding dry run',
        status: 'done',
        kind: 'job',
        model: 'gpt-5.4',
        totalTokens: 8_910,
        estimatedCostUsd: 0.94,
        lastMessagePreview: 'Checklist complete and archived.',
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
      },
      {
        key: 'sess-kill-1',
        derivedTitle: 'Abandoned investigation',
        status: 'killed',
        kind: 'chat',
        model: 'gpt-5.4-mini',
        totalTokens: 2_140,
        estimatedCostUsd: 0.11,
        lastMessagePreview: 'Stopped after the operator took over manually.',
        updatedAt: Date.now() - 6 * 60 * 60 * 1000,
      },
      {
        key: 'sess-timeout-1',
        derivedTitle: 'Nightly metrics sweep',
        status: 'timeout',
        kind: 'job',
        model: 'gpt-5.4-mini',
        totalTokens: 4_800,
        estimatedCostUsd: 0.29,
        lastMessagePreview: 'Timed out waiting on the upstream metrics store.',
        updatedAt: Date.now() - 26 * 60 * 60 * 1000,
      },
    ],
  },
  {
    instanceId: 'hermes-lab',
    error: 'Session API unavailable for stopped Hermes instance',
    sessions: [],
  },
];

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

function ensureScreenshotsDir() {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function shot(target: Page | Locator, filename: string) {
  ensureScreenshotsDir();
  await target.screenshot({
    path: path.join(screenshotsDir, filename),
  });
}

async function mountGuideDashboard(page: Page) {
  const normalizedInstances = instances.map(normalizeInstance);
  await page.setViewportSize({ width: 1600, height: 1200 });

  await page.addInitScript(() => {
    window.localStorage.setItem('lang', 'en');

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
          this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({
              id: 'log-2',
              line: '[fleet] Restart requested after config save.',
              ts: Date.now(),
            }),
          }));
          this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({
              id: 'log-3',
              line: '[gateway] Device req-9 approved from 10.0.0.8.',
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
        username: 'admin',
        role: 'admin',
        assignedProfiles: [],
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
        mode: 'hybrid',
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(normalizedInstances[0]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(normalizedInstances[0]),
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
      body: JSON.stringify({
        pending: [
          { requestId: 'req-9', ip: '10.0.0.8' },
          { requestId: 'req-12', ip: '10.0.0.19' },
        ],
      }),
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
        pending: [
          { code: 'PAIR-001', userId: 'u_ops_2048' },
          { code: 'PAIR-002', userId: 'u_finance_117' },
        ],
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
            version: '1.2.0',
            origin: 'npm',
            status: 'enabled',
            enabled: true,
          },
          {
            id: '@openclaw/log-shipper',
            name: 'Log Shipper',
            description: 'Streams runtime logs to the control plane.',
            version: '0.9.4',
            origin: 'local',
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
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function openManageInstances(page: Page) {
  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();
}

async function openInstance(page: Page, instanceId: string) {
  await openManageInstances(page);
  await page.locator('.table-shell tr', { hasText: instanceId }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
}

test.describe('Guide screenshots', () => {
  test('00 — dashboard overview', async ({ page }) => {
    await mountGuideDashboard(page);
    await shot(page, '00-dashboard.png');
  });

  test('01 — manage instances panel and add instance dialog', async ({ page }) => {
    await mountGuideDashboard(page);
    await openManageInstances(page);
    await shot(page, '01-sidebar-manage-instances.png');

    await page.getByRole('button', { name: '+ Add Instance' }).click();
    await expect(page.getByRole('button', { name: 'Create OpenClaw Docker' })).toBeVisible();
    await shot(page, '01-add-instance-button.png');

    await page.getByRole('button', { name: 'Create OpenClaw Profile' }).click();
    const dialog = page.locator('.dialog-card');
    await expect(dialog.getByRole('heading', { name: 'Add Profile' })).toBeVisible();
    await shot(dialog, '01-add-instance-dialog.png');
  });

  test('02 — overview tab', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');
    await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();
    await shot(page, '02-overview-tab.png');
  });

  test('03 — users panel and add user form', async ({ page }) => {
    await mountGuideDashboard(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    await shot(page, '03-sidebar-users.png');

    const usersTable = page.locator('.table-shell');
    await expect(usersTable.getByText('alice')).toBeVisible();
    await shot(usersTable, '03-users-panel.png');

    const addUserPanel = page.locator('section.panel-card .panel-card').filter({
      has: page.getByRole('heading', { name: 'Add User' }),
    });
    await shot(addUserPanel, '03-add-user-dialog.png');
  });

  test('04 — control UI tab with pending devices', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');
    await page.getByRole('button', { name: 'control ui' }).click();
    await expect(page.getByText('10.0.0.8')).toBeVisible();
    await shot(page.locator('section.panel-card').last(), '04-controlui-pending.png');
  });

  test('05 — feishu tab', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');
    await page.getByRole('button', { name: 'feishu' }).click();
    const feishuPanel = page.locator('section.panel-card').last();
    await expect(feishuPanel.getByRole('heading', { name: 'Feishu Channel' })).toBeVisible();
    await shot(feishuPanel, '05-feishu-config.png');

    const pendingCard = feishuPanel.locator('.metric-card').last();
    await expect(pendingCard.getByText('PAIR-001')).toBeVisible();
    await shot(pendingCard, '05-feishu-pending.png');
  });

  test('06 — logs and metrics tabs', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');

    await page.getByRole('button', { name: 'logs' }).click();
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await shot(page, '06-logs-tab.png');

    await page.getByRole('button', { name: 'metrics' }).click();
    await expect(page.getByRole('heading', { name: 'CPU History' })).toBeVisible();
    await shot(page, '06-metrics-tab.png');
  });

  test('07 — plugins tab', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');
    await page.getByRole('button', { name: 'plugins' }).click();
    await expect(page.getByRole('heading', { name: 'Plugins' })).toBeVisible();
    await shot(page, '07-plugins-tab.png');
  });

  test('08 — config tab', async ({ page }) => {
    await mountGuideDashboard(page);
    await openInstance(page, 'openclaw-1');
    await page.getByRole('button', { name: 'config', exact: true }).click();
    await expect(page.getByText('Edit raw instance JSON carefully.')).toBeVisible();
    await expect(page.getByText('"appId": "cli_liveops"')).toBeVisible({ timeout: 15_000 });
    await shot(page, '08-config-tab.png');
  });
});
