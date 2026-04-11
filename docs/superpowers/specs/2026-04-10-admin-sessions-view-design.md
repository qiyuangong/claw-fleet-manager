# Admin Sessions View — Design Spec

**Date:** 2026-04-10  
**Status:** Approved

## Overview

Add an admin-only "Sessions" view to the Claw Fleet Manager dashboard. The view aggregates active and recent sessions from all running openclaw instances and displays them in a single panel, giving admins visibility into which instances are in use and what work is in progress.

"Tasks" in openclaw (internal todo items) are not exposed via the gateway API. The meaningful proxy for "work in progress" is the session: each session has a `status` field (`running`, `done`, `failed`, `killed`, `timeout`), a derived title, a last-message preview, model info, and timing data — sufficient for an admin overview.

---

## Backend

### New service: `packages/server/src/services/openclaw-client.ts`

A minimal, self-contained WebSocket client that speaks the openclaw gateway protocol just enough to call one method and return.

**Protocol steps:**
1. Open `ws://127.0.0.1:<port>`
2. Wait for `{type:"event", event:"connect.challenge"}` (nonce not required for token-only auth)
3. Send `connect` request:
   ```json
   {
     "type": "req", "id": "<uuid>", "method": "connect",
     "params": {
       "minProtocol": 3, "maxProtocol": 3,
       "role": "operator", "scopes": ["operator.read"],
       "auth": { "token": "<gateway_token>" }
     }
   }
   ```
4. Wait for `connect` response (ok)
5. Send `sessions.list` request:
   ```json
   {
     "type": "req", "id": "<uuid>", "method": "sessions.list",
     "params": { "activeMinutes": 60 }
   }
   ```
6. Return the sessions payload, then close the WS

**Timeout:** 5 seconds total per connection. On timeout or WS error, reject with a descriptive error.

**Exported function:**
```ts
async function fetchInstanceSessions(port: number, token: string): Promise<GatewaySessionRow[]>
```

The client does not persist or reuse connections — one call, one connection.

### New route: `GET /api/fleet/sessions`

Added to `packages/server/src/routes/instances.ts` (or a new `sessions.ts` route file).

**Auth:** Admin-only. Returns 403 if the caller is not an admin.

**Behavior:**
1. Call `app.backend.getCachedStatus()` to get all instances
2. Filter to `status === 'running'` instances
3. For each running instance, call `fetchInstanceSessions(instance.port, await app.backend.revealToken(instance.id))` in parallel (`Promise.allSettled`)
4. Return a combined result within a 6-second overall deadline

**Response shape:**
```ts
{
  instances: Array<{
    instanceId: string;
    sessions: GatewaySessionRow[];  // empty array if instance returned no sessions
    error?: string;                  // present if this instance's fetch failed
  }>;
  updatedAt: number;  // unix ms
}
```

Partial failures (one instance down) do not fail the whole request — the failing instance entry includes an `error` string and an empty `sessions` array.

---

## Frontend

### Store (`packages/web/src/store.ts`)

Add `{ type: 'sessions' }` to the `ActiveView` union and a `selectSessions` action.

### React Query hook: `packages/web/src/hooks/useFleetSessions.ts`

- Calls `GET /api/fleet/sessions` via `apiFetch`
- Polls every 15 seconds (`refetchInterval: 15_000`)
- Only enabled when the current user is admin

### New component: `packages/web/src/components/instances/FleetSessionsPanel.tsx`

**Layout:**

```
[ Active Sessions ]  — 3 instances, 5 running sessions  — updated 2s ago  [Refresh]

┌─ instance-1  [running] ────────────────────────────────────────────────┐
│  • "Refactor auth middleware"   [running]   claude-opus-4   12m 30s    │
│    Last: "I've updated the token validation logic in auth.ts..."        │
│  • "Fix CI flake"               [done]      claude-sonnet  3m 10s      │
│    Last: "The test now passes. The race condition was in..."            │
└────────────────────────────────────────────────────────────────────────┘

┌─ instance-2  [running] ─────── [fetch error: connection refused] ──────┐
│  ⚠ Could not fetch sessions for this instance                          │
└────────────────────────────────────────────────────────────────────────┘
```

**Session row fields:**
- Title: `derivedTitle` → `label` → `key` (fallback chain)
- Status badge: `running` (green), `done` (muted), `failed`/`killed`/`timeout` (red/orange)
- Model name (short form, e.g. `claude-opus-4`)
- Runtime: formatted from `runtimeMs` (or `Date.now() - startedAt` for running sessions)
- Last message preview: `lastMessagePreview`, truncated at 80 characters

**Filter:** Show all sessions returned (server already filters by `activeMinutes: 60`). No client-side filtering in v1.

**Empty state:** "No active sessions across any running instance."

**Instance header** includes a link/button to navigate to that instance's panel (calls `selectInstance(id)`).

### Shell wiring (`packages/web/src/components/layout/Shell.tsx`)

Add branch: `activeView.type === 'sessions'` → `<FleetSessionsPanel />`

### Sidebar wiring (`packages/web/src/components/layout/Sidebar.tsx`)

Under the Admin section, add a "Sessions" nav item (between "Manage Instances" and "Users"):
```tsx
<button
  className={`sidebar-nav-item${activeView.type === 'sessions' ? ' selected' : ''}`}
  onClick={selectSessions}
>
  {t('sessions')}
</button>
```

Add `sessions` key to i18n files (`en` and `zh`).

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Instance is stopped | Excluded from fetch (only `running` instances are queried) |
| Instance WS times out (5s) | Instance entry has `error` string, `sessions: []`, UI shows warning |
| `revealToken` fails | That instance skipped, treated as error |
| All instances fail | Response returns empty instances array with errors; UI shows full error state |
| React Query refetch fails | Stale data shown with "last updated X ago" indicator; no full error page |
| Non-admin access | Server returns 403; hook disabled for non-admins |

---

## Testing

**Server:**
- Unit test `fetchInstanceSessions` using a mock WS server that replays the openclaw handshake and returns fixture session data
- Unit test timeout behavior (mock WS that never responds)
- Route test for `GET /api/fleet/sessions`: verify fan-out, partial-failure shape, 403 for non-admin

**Frontend:**
- Render test for `FleetSessionsPanel` with mocked `useFleetSessions` returning fixture data
- Render test for empty state and per-instance error state

---

## Out of Scope (v1)

- Real-time updates via `sessions.subscribe` (polling at 15s is sufficient for v1)
- Filtering by session status in the UI
- Clicking into a session to view transcript (requires additional openclaw API integration)
- Non-admin users seeing their own sessions
