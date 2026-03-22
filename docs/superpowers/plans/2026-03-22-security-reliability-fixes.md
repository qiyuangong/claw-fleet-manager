# Security & Reliability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical and important issues from codebase evaluation: input validation, failing tests, auth tests, graceful shutdown, scale concurrency guard, async directory sizing, and proxy credential exposure.

**Architecture:** Add a shared `INSTANCE_ID_RE` regex for route-level validation, Zod schemas for config write bodies, timing-safe auth comparison, a scale mutex, async `getDirectorySize`, graceful shutdown handler, and replace raw credential injection in proxy with an HMAC token.

**Tech Stack:** Node.js, Fastify, Vitest, Zod, crypto (timingSafeEqual, createHmac)

---

### Task 1: Validate instance `id` parameter in all routes

**Files:**
- Create: `packages/server/src/validate.ts`
- Modify: `packages/server/src/routes/instances.ts`
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/src/routes/logs.ts`
- Modify: `packages/server/tests/routes/instances.test.ts`

The `id` parameter from URLs like `/api/fleet/:id/start` is passed directly to Docker API calls without validation. An authenticated user could operate on arbitrary Docker containers.

- [ ] **Step 1: Create validation module**

Create `packages/server/src/validate.ts`:

```typescript
export const INSTANCE_ID_RE = /^openclaw-\d+$/;

export function validateInstanceId(id: string): boolean {
  return INSTANCE_ID_RE.test(id);
}
```

- [ ] **Step 2: Write failing tests for invalid `id`**

Add to `packages/server/tests/routes/instances.test.ts`:

```typescript
it('rejects invalid instance id on start', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/fleet/evil-container/start' });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('INVALID_ID');
});

it('rejects invalid instance id on token reveal', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/fleet/../../etc/passwd/token/reveal' });
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe('INVALID_ID');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run tests/routes/instances.test.ts`
Expected: FAIL — the routes currently accept any `id`

- [ ] **Step 4: Add validation to instances.ts**

Add at top of `instances.ts`:
```typescript
import { validateInstanceId } from '../validate.js';
```

Add validation guard as the first line in each handler that uses `id`:
```typescript
if (!validateInstanceId(id)) {
  return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
}
```

Apply to: `start`, `stop`, `restart`, `devices/pending`, `devices/:requestId/approve`, and `token/reveal` handlers.

- [ ] **Step 5: Add validation to config.ts**

Add the same import and validation guard to `GET /api/fleet/:id/config` and `PUT /api/fleet/:id/config` in `config.ts`. For config routes, the `id` is parsed via `parseInt(id.replace('openclaw-', ''))` — add the validation before the parse:

```typescript
const { id } = request.params;
if (!validateInstanceId(id)) {
  return reply.status(400).send({ error: 'Invalid instance id', code: 'INVALID_ID' });
}
const index = parseInt(id.replace('openclaw-', ''), 10);
```

- [ ] **Step 6: Add validation to logs.ts**

Add import and validation guard to the `/ws/logs/:id` handler in `logs.ts`:

```typescript
if (!validateInstanceId(id)) {
  socket.send(JSON.stringify({ error: 'Invalid instance id' }));
  socket.close();
  return;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/routes/instances.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/validate.ts packages/server/src/routes/instances.ts packages/server/src/routes/config.ts packages/server/src/routes/logs.ts packages/server/tests/routes/instances.test.ts
git commit -m "fix(security): validate instance id parameter in all routes"
```

---

### Task 2: Add input validation to config write endpoints

**Files:**
- Modify: `packages/server/src/routes/config.ts`
- Modify: `packages/server/tests/routes/config.test.ts`

The `PUT /api/config/fleet` and `PUT /api/fleet/:id/config` endpoints accept arbitrary request bodies without schema validation.

- [ ] **Step 1: Write failing test for fleet config validation**

Add to `packages/server/tests/routes/config.test.ts`:

```typescript
it('PUT /api/config/fleet rejects non-object body', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/config/fleet',
    payload: 'not an object',
    headers: { 'content-type': 'application/json' },
  });
  expect(res.statusCode).toBe(400);
});

it('PUT /api/config/fleet rejects non-string values', async () => {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/config/fleet',
    payload: { COUNT: 5 },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/routes/config.test.ts`
Expected: FAIL

- [ ] **Step 3: Add Zod validation to config.ts**

```typescript
import { z } from 'zod';
import { validateInstanceId } from '../validate.js';

const fleetConfigBodySchema = z.record(z.string(), z.string());
const instanceConfigBodySchema = z.record(z.string(), z.unknown());
```

Add to `PUT /api/config/fleet`:
```typescript
app.put('/api/config/fleet', async (request, reply) => {
  const parsed = fleetConfigBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: 'Body must be a Record<string, string>', code: 'INVALID_BODY' });
  }
  app.fleetConfig.writeFleetConfig(parsed.data);
  return { ok: true };
});
```

Add to `PUT /api/fleet/:id/config`:
```typescript
const parsed = instanceConfigBodySchema.safeParse(request.body);
if (!parsed.success) {
  return reply.status(400).send({ error: 'Body must be a JSON object', code: 'INVALID_BODY' });
}
app.fleetConfig.writeInstanceConfig(index, parsed.data);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/routes/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/config.ts packages/server/tests/routes/config.test.ts
git commit -m "fix(security): add input validation to config write endpoints"
```

---

### Task 3: Fix failing proxy tests

**Files:**
- Modify: `packages/server/tests/routes/proxy.test.ts`

The `stripFrameHeaders` implementation now drops CSP entirely, but two tests still expect CSP rewriting behavior.

- [ ] **Step 1: Update the CSP tests**

Replace the two CSP tests in `proxy.test.ts`:

```typescript
it('drops CSP entirely', () => {
  const result = stripFrameHeaders({
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
  });
  expect(result['content-security-policy']).toBeUndefined();
});

it('drops CSP even without frame-ancestors', () => {
  const result = stripFrameHeaders({
    'content-security-policy': "default-src 'self'",
  });
  expect(result['content-security-policy']).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/routes/proxy.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/routes/proxy.test.ts
git commit -m "fix(test): update proxy CSP tests to match current strip behavior"
```

---

### Task 4: Add auth middleware tests

**Files:**
- Create: `packages/server/tests/routes/auth.test.ts`

The authentication module (`auth.ts`) has zero test coverage despite being the security boundary.

- [ ] **Step 1: Write auth tests**

Create `packages/server/tests/routes/auth.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAuth } from '../../src/auth.js';

const config = {
  port: 3001,
  auth: { username: 'admin', password: 'secret' },
  fleetDir: '/tmp',
};

describe('Auth middleware', () => {
  const app = Fastify();

  beforeAll(async () => {
    await registerAuth(app, config);
    app.get('/api/test', async () => ({ ok: true }));
    app.get('/proxy/test', async () => ({ ok: true }));
    app.get('/ws/test', async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(() => app.close());

  it('allows valid Basic Auth', async () => {
    const encoded = Buffer.from('admin:secret').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects missing auth with 401 and www-authenticate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/test' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
  });

  it('rejects wrong credentials', async () => {
    const encoded = Buffer.from('admin:wrong').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed base64', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: 'Basic !!!notbase64' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects base64 without colon separator', async () => {
    const encoded = Buffer.from('nocolon').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Basic ${encoded}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('suppresses www-authenticate on proxy paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/proxy/test' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
  });

  it('allows query auth on proxy paths and sets cookie', async () => {
    const encoded = Buffer.from('admin:secret').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/test?auth=${encoded}`,
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.headers['set-cookie'] as string;
    expect(cookie).toContain('x-fleet-proxy-auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('allows cookie auth on proxy paths', async () => {
    const encoded = Buffer.from('admin:secret').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: '/proxy/test',
      headers: { cookie: `x-fleet-proxy-auth=${encoded}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows query auth on /ws/ paths', async () => {
    const encoded = Buffer.from('admin:secret').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: `/ws/test?auth=${encoded}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects wrong query auth on proxy paths', async () => {
    const encoded = Buffer.from('admin:wrong').toString('base64');
    const res = await app.inject({
      method: 'GET',
      url: `/proxy/test?auth=${encoded}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/routes/auth.test.ts`
Expected: PASS (these tests validate existing behavior)

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/routes/auth.test.ts
git commit -m "test: add comprehensive auth middleware tests"
```

---

### Task 5: Add graceful shutdown

**Files:**
- Modify: `packages/server/src/index.ts`

No SIGTERM/SIGINT handler exists. MonitorService interval isn't cleared and Fastify connections aren't drained on shutdown.

- [ ] **Step 1: Add shutdown handler to index.ts**

Add after `monitor.start()` and the Tailscale sync block (before the `app.listen` call):

```typescript
async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  monitor.stop();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

- [ ] **Step 2: Verify server starts and stops cleanly**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass (shutdown handler doesn't affect test setup)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "fix(reliability): add graceful shutdown handler for SIGTERM/SIGINT"
```

---

### Task 6: Add concurrency guard to scale endpoint

**Files:**
- Modify: `packages/server/src/routes/fleet.ts`
- Modify: `packages/server/tests/routes/fleet.test.ts`

Two concurrent scale requests can interleave and produce inconsistent state (compose file written by request A, overwritten by request B before docker compose up completes).

- [ ] **Step 1: Write failing test for concurrent scale**

Add to `packages/server/tests/routes/fleet.test.ts`:

```typescript
it('rejects concurrent scale requests', async () => {
  // First request should be accepted; second should get 409
  const [res1, res2] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 2 } }),
    app.inject({ method: 'POST', url: '/api/fleet/scale', payload: { count: 3 } }),
  ]);
  const codes = [res1.statusCode, res2.statusCode].sort();
  expect(codes).toContain(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/routes/fleet.test.ts`
Expected: FAIL

- [ ] **Step 3: Add mutex to fleet.ts**

Add at the top of `fleet.ts` (after imports):

```typescript
let scaling = false;
```

Add at the start of the `POST /api/fleet/scale` handler (after Zod validation):

```typescript
if (scaling) {
  return reply.status(409).send({ error: 'Scale operation already in progress', code: 'SCALE_IN_PROGRESS' });
}
scaling = true;
try {
  // ... existing scale logic ...
} finally {
  scaling = false;
}
```

Wrap the entire existing body (from `const { count }` through `return { ok: true, fleet: status }`) inside the try block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/routes/fleet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/fleet.ts packages/server/tests/routes/fleet.test.ts
git commit -m "fix(reliability): add concurrency guard to scale endpoint"
```

---

### Task 7: Replace sync `getDirectorySize` with async version

**Files:**
- Modify: `packages/server/src/services/monitor.ts`
- Modify: `packages/server/tests/services/monitor.test.ts`

`getDirectorySize` uses `statSync`/`readdirSync` which blocks the event loop on every 5s refresh for every instance. It's also redundant when `docker.df()` succeeds (which overwrites the values).

- [ ] **Step 1: Replace sync filesystem calls with async**

In `packages/server/src/services/monitor.ts`, replace:

```typescript
import { statSync, readdirSync } from 'node:fs';
```

with:

```typescript
import { stat, readdir } from 'node:fs/promises';
```

Replace the `getDirectorySize` method:

```typescript
private async getDirectorySize(path: string): Promise<number> {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return stats.size;
    }

    const entries = await readdir(path);
    const sizes = await Promise.all(
      entries.map((entry) => this.getDirectorySize(join(path, entry))),
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}
```

Update the calls in `refresh()` — change lines 71-72 from synchronous to await:

```typescript
disk: {
  config: await this.getDirectorySize(join(configBase, String(index))),
  workspace: await this.getDirectorySize(join(workspaceBase, String(index))),
},
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/services/monitor.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/monitor.ts
git commit -m "fix(perf): replace sync getDirectorySize with async to avoid blocking event loop"
```

---

### Task 8: Replace raw proxy credential injection with HMAC token

**Files:**
- Modify: `packages/server/src/routes/proxy.ts`
- Modify: `packages/server/src/auth.ts`
- Modify: `packages/server/src/index.ts`

The current proxy HTML injection embeds the raw Basic Auth credentials (base64) into every proxied page's JavaScript. Malicious scripts in the proxied content could extract them. Replace with a short-lived HMAC token that the auth middleware validates — the real credentials never reach the page.

- [ ] **Step 1: Add HMAC token helpers to auth.ts**

Add to `packages/server/src/auth.ts`:

```typescript
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PROXY_TOKEN_SECRET = randomBytes(32);
const PROXY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateProxyToken(): string {
  const expires = Date.now() + PROXY_TOKEN_TTL_MS;
  const payload = String(expires);
  const sig = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function validateProxyToken(token: string): boolean {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expires = parseInt(payload, 10);
  if (isNaN(expires) || Date.now() > expires) return false;
  const expected = createHmac('sha256', PROXY_TOKEN_SECRET).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Use timing-safe comparison for credential checking**

In `auth.ts`, update `isAuthorized`:

```typescript
function isAuthorized(
  credentials: { username: string; password: string } | null,
  config: ServerConfig,
): boolean {
  if (!credentials) return false;
  try {
    const userMatch = timingSafeEqual(
      Buffer.from(credentials.username),
      Buffer.from(config.auth.username),
    );
    const passMatch = timingSafeEqual(
      Buffer.from(credentials.password),
      Buffer.from(config.auth.password),
    );
    return userMatch && passMatch;
  } catch {
    return false; // length mismatch
  }
}
```

- [ ] **Step 3: Accept proxy token in auth middleware**

In the `onRequest` hook in `auth.ts`, add proxy token validation for proxy paths. After the cookie check and before the query auth check, add:

```typescript
const queryToken = new URL(rawUrl, 'http://localhost').searchParams.get('proxyToken');
if (queryToken && validateProxyToken(queryToken)) {
  return;
}
```

- [ ] **Step 4: Update proxy.ts to inject HMAC token instead of raw credentials**

In `proxy.ts`, import and use the new token generator:

```typescript
import { generateProxyToken } from '../auth.js';
```

In `buildInjectedScript`, change the parameter from `proxyAuth: string` to `proxyToken: string`, and update the variable injection:

```typescript
function buildInjectedScript(token: string, proxyToken: string): string {
```

Change the line that sets `var a=...`:
```typescript
`var a=${JSON.stringify(proxyToken)};` +
```

Change the `withAuth` function to use `proxyToken` query param:
```typescript
`if(u.pathname.startsWith('/proxy/'))u.searchParams.set('proxyToken',a);` +
```

In `httpProxy`, change the call site from:
```typescript
const script = buildInjectedScript(token, app.proxyAuth);
```
to:
```typescript
const script = buildInjectedScript(token, generateProxyToken());
```

- [ ] **Step 5: Run all tests**

Run: `cd packages/server && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth.ts packages/server/src/routes/proxy.ts packages/server/src/index.ts
git commit -m "fix(security): replace raw credential injection with HMAC proxy token"
```

---

## Verification

After all tasks, run the full test suite:

```bash
cd packages/server && npx vitest run
```

All tests should pass. Then verify no regressions:

```bash
npm run build
npm run lint
```
