import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.reload();

  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('user login shows only assigned profile access', async ({ page }) => {
  await signIn(page, 'qiyuan', '1234qwer');

  await expect(page.getByRole('button', { name: /qiyuan \(user\)/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toHaveCount(0);
  await expect(page.locator('.profile-card')).toHaveCount(1);
  await expect(page.locator('.profile-card')).toContainText('qiyuan');
  await expect(page.locator('.profile-card')).toContainText(':18849');
});

test('admin login shows admin controls', async ({ page }) => {
  await signIn(page, 'admin', 'bigdl123');

  await expect(page.getByRole('button', { name: /admin \(admin\)/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toBeVisible();
});
