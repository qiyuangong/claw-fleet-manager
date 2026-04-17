import { expect, test, type Page, type Route } from '@playwright/test';

type RuntimeCapabilities = {
  configEditor: boolean;
  logs: boolean;
  rename: boolean;
  delete: boolean;
  proxyAccess: boolean;
  sessions: boolean;
  plugins: boolean;
  runtimeAdmin: boolean;
};

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

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mountHistoryView(page: Page) {
  await page.route('**/api/users/me', async (route) => {
    await fulfillJson(route, {
      username: 'admin',
      role: 'admin',
      assignedProfiles: [],
    });
  });

  await page.route('**/api/config/fleet', async (route) => {
    await fulfillJson(route, {
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
    });
  });

  await page.route('**/api/fleet', async (route) => {
    await fulfillJson(route, {
      mode: 'docker',
      totalRunning: 2,
      updatedAt: Date.now(),
      instances: [
        {
          id: 'alpha-host',
          runtime: 'openclaw',
          mode: 'docker',
          runtimeCapabilities: openclawCapabilities,
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
          id: 'beta-host',
          runtime: 'openclaw',
          mode: 'docker',
          runtimeCapabilities: openclawCapabilities,
          status: 'running',
          port: 3121,
          token: 'masked-token-2',
          uptime: 10_200,
          cpu: 11.5,
          memory: { used: 1024 * 1024 * 420, limit: 1024 * 1024 * 1024 },
          disk: { config: 1024 * 1024 * 31, workspace: 1024 * 1024 * 388 },
          health: 'healthy',
          image: 'openclaw:local',
        },
      ],
    });
  });

  await page.route('**/api/fleet/sessions/history**', async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');

    if (status === 'active') {
      await fulfillJson(route, {
        instances: [
          {
            instanceId: 'alpha-host',
            sessions: [
              {
                key: 'run-1',
                derivedTitle: 'Alpha running',
                status: 'running',
                lastMessagePreview: 'alpha is still working',
                updatedAt: Date.now() - 5_000,
              },
            ],
          },
        ],
        updatedAt: Date.now(),
        totalEstimate: 1,
      });
      return;
    }

    await fulfillJson(route, {
      instances: [
        {
          instanceId: 'alpha-host',
          sessions: [
            {
              key: 'done-1',
              derivedTitle: 'Alpha completed',
              status: 'done',
              lastMessagePreview: 'alpha finished successfully',
              updatedAt: Date.now() - 10_000,
            },
          ],
        },
      ],
      updatedAt: Date.now(),
      totalEstimate: 1,
    });
  });

  await page.goto('/?view=sessions&status=done&time=7d&q=alpha');
}

test('history filters pre-apply from URL and update in place', async ({ page }) => {
  await mountHistoryView(page);

  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search instance, session, model, or preview' })).toHaveValue('alpha');
  await expect(page.getByText('Alpha completed')).toBeVisible();

  await page.getByRole('button', { name: 'Active' }).click();

  await expect(page).toHaveURL(/view=sessions/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page).toHaveURL(/time=7d/);
  await expect(page).toHaveURL(/q=alpha/);
  await expect(page.getByText('Alpha running')).toBeVisible();
});
