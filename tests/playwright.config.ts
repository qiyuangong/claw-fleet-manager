import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const webServerCommand = process.env.PLAYWRIGHT_SERVER_COMMAND;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    headless: true,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  ...(webServerCommand
    ? {
        webServer: {
          command: webServerCommand,
          url: baseURL,
          reuseExistingServer: true,
        },
      }
    : {}),
});
