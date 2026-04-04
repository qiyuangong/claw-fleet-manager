import { expect, test, type Page } from '@playwright/test';

const adminUsername = process.env.PLAYWRIGHT_ADMIN_USERNAME;
const adminPassword = process.env.PLAYWRIGHT_ADMIN_PASSWORD;
const userUsername = process.env.PLAYWRIGHT_USER_USERNAME;
const userPassword = process.env.PLAYWRIGHT_USER_PASSWORD;

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

test('user login shows only assigned instance access', async ({ page }) => {
  test.skip(!userUsername || !userPassword, 'PLAYWRIGHT_USER_USERNAME and PLAYWRIGHT_USER_PASSWORD are required');

  await signIn(page, userUsername!, userPassword!);

  await expect(page.getByRole('button', { name: new RegExp(`${userUsername} \\(user\\)`, 'i') })).toBeVisible();
  await expect(page.getByRole('button', { name: 'My Account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toHaveCount(0);
  await expect(page.getByText(/You currently have \d+ assigned instance/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Instances' })).toBeVisible();
});

test('admin login shows admin controls', async ({ page }) => {
  test.skip(!adminUsername || !adminPassword, 'PLAYWRIGHT_ADMIN_USERNAME and PLAYWRIGHT_ADMIN_PASSWORD are required');

  await signIn(page, adminUsername!, adminPassword!);

  await expect(page.getByRole('button', { name: new RegExp(`${adminUsername} \\(admin\\)`, 'i') })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fleet Config' })).toBeVisible();
});
