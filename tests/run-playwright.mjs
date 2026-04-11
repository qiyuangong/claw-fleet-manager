import { spawnSync } from 'node:child_process';

const hasBaseUrl = Boolean(process.env.PLAYWRIGHT_BASE_URL);
const hasServerCommand = Boolean(process.env.PLAYWRIGHT_SERVER_COMMAND);

if (!hasBaseUrl && !hasServerCommand) {
  console.error(
    [
      'npm run test:e2e requires one of these environment variables:',
      '- PLAYWRIGHT_BASE_URL: URL of an already-running dashboard deployment',
      '- PLAYWRIGHT_SERVER_COMMAND: command Playwright should run to start the app',
      '',
      'Example against an existing local deploy:',
      'PLAYWRIGHT_BASE_URL=https://localhost:3001 npm run test:e2e',
    ].join('\n'),
  );
  process.exit(1);
}

const playwrightBinary = process.platform === 'win32' ? 'playwright.cmd' : 'playwright';
const result = spawnSync(playwrightBinary, ['test', '--config', 'tests/playwright.config.ts'], {
  env: process.env,
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
