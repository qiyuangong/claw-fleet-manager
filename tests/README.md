# Tests

<p align="center">
  <a href="README_CN.md"><strong>简体中文</strong></a>
</p>

This directory contains the project’s Playwright end-to-end coverage and related test assets.

## Layout

```text
tests/
└─ e2e/
   ├─ auth-smoke.spec.ts
   ├─ screenshot-guide.spec.ts
   └─ ui-merge.spec.ts
```

## Run Playwright tests

From the repository root:

```bash
npm run test:e2e
```

## Required runtime options

The Playwright runner needs either:

1. a running deployment URL, or
2. a command it can use to boot the app before the test run

### Option 1: point at an existing deployment

```bash
PLAYWRIGHT_BASE_URL=https://localhost:3001 npm run test:e2e
```

### Option 2: let Playwright start the app

```bash
PLAYWRIGHT_SERVER_COMMAND="npm run dev" \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 \
npm run test:e2e
```

## Auth smoke tests

The auth smoke coverage reads credentials from environment variables. If they are not provided, those tests skip cleanly.

```bash
PLAYWRIGHT_USER_USERNAME=testuser \
PLAYWRIGHT_USER_PASSWORD=testuser \
PLAYWRIGHT_ADMIN_USERNAME=admin \
PLAYWRIGHT_ADMIN_PASSWORD=changeme \
PLAYWRIGHT_BASE_URL=https://localhost:3001 \
npm run test:e2e
```

## Notes

- `PLAYWRIGHT_BASE_URL` should point at the UI entrypoint you want to test
- use HTTPS when exercising flows that depend on the secure server setup
- if you use self-signed local TLS, make sure the target environment is already trusted enough for the browser session you are running
