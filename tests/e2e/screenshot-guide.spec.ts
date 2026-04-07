// tests/e2e/screenshot-guide.spec.ts
import { expect, test, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const adminUsername = process.env.PLAYWRIGHT_ADMIN_USERNAME;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;

const screenshotsDir = path.resolve('docs/guides/screenshots');

async function signInAsAdmin(page: Page) {
  // Inject auth token directly into sessionStorage — bypasses the login form entirely
  const token = Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64');
  await page.goto('/');
  await page.evaluate((t: string) => {
    sessionStorage.setItem('fleet_manager_session_auth', t);
    localStorage.setItem('lang', 'en');
  }, token);
  await page.reload();
  await expect(page.getByRole('button', { name: /admin/i })).toBeVisible({ timeout: 15_000 });
}

async function shot(page: Page, filename: string) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, filename), fullPage: false });
}

test.describe('Guide screenshots', () => {
  test.skip(!adminUsername || !adminPassword,
    'Set PLAYWRIGHT_ADMIN_USERNAME and PLAYWRIGHT_ADMIN_PASSWORD to capture screenshots');

  test('00 — dashboard overview', async ({ page }) => {
    await signInAsAdmin(page);
    // Select first instance if any exist so the tab row is visible
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) await firstInstance.click();
    await shot(page, '00-dashboard.png');
  });

  test('01 — manage instances panel and add instance dialog', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('button', { name: 'Manage Instances' }).click();
    await shot(page, '01-sidebar-manage-instances.png');
    await page.getByRole('button', { name: /Add Instance/i }).click();
    await shot(page, '01-add-instance-button.png');
    await page.getByRole('button', { name: 'Create Profile' }).click();
    await shot(page, '01-add-instance-dialog.png');
    await page.keyboard.press('Escape');
  });

  test('02 — overview tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /overview/i }).click();
      await shot(page, '02-overview-tab.png');
    }
  });

  test('03 — users panel and add user dialog', async ({ page }) => {
    await signInAsAdmin(page);
    await page.getByRole('button', { name: 'Users' }).click();
    await shot(page, '03-sidebar-users.png');
    await shot(page, '03-users-panel.png');
    // Add User form is always visible inline — capture it directly
    await shot(page, '03-add-user-dialog.png');
  });

  test('04 — control UI tab with pending devices', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /control ui/i }).click();
      await shot(page, '04-controlui-pending.png');
    }
  });

  test('05 — feishu tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /feishu/i }).click();
      await shot(page, '05-feishu-config.png');
      await shot(page, '05-feishu-pending.png');
    }
  });

  test('06 — logs and metrics tabs', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /logs/i }).click();
      await page.waitForTimeout(1_000); // let logs stream in
      await shot(page, '06-logs-tab.png');
      await page.getByRole('button', { name: /metrics/i }).click();
      await page.waitForTimeout(500);
      await shot(page, '06-metrics-tab.png');
    }
  });

  test('07 — plugins tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /plugins/i }).click();
      await shot(page, '07-plugins-tab.png');
    }
  });

  test('08 — config tab', async ({ page }) => {
    await signInAsAdmin(page);
    const firstInstance = page.locator('.sidebar-item').first();
    if (await firstInstance.isVisible()) {
      await firstInstance.click();
      await page.getByRole('button', { name: /^config$/i }).click();
      await page.waitForTimeout(500); // let Monaco load
      await shot(page, '08-config-tab.png');
    }
  });
});
