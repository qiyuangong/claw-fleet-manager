# Activity and Dashboard Session-History Persistence Design

**Date:** 2026-04-17
**Status:** Approved
**Feature:** Persist openclaw session snapshots on the fleet server so the Dashboard and Activity pages stop losing history across auto-refresh, page navigation, and time-filter changes.

## Background

Today `GET /api/fleet/sessions` fans out live to every running instance and calls openclaw's `sessions.list` with `activeMinutes: 60`. Any session idle for more than an hour is invisible to the fleet manager. The web layer refetches this live snapshot every 15 seconds and replaces the cache, so "history" on the Dashboard and Activity pages decays continuously. The time-filter UI offers `today / 24h / 7d / all`, but the underlying data window is capped at 60 minutes, making the broader choices misleading. Filter state (`statusFilter`, `timeFilter`, `searchQuery`, `statusFocus`) lives in local `useState` and resets whenever the user switches panels.

## Goals

- Persist enough session history on the fleet server that the Dashboard trend charts and Activity listings remain accurate over the retention window.
- Make the time-filter UI honest: `7d` and `all` show real data, not a 60-minute slice.
- Make filter state survive page navigation, refresh, and back/forward, and make filtered views shareable via URL.
- Keep existing "live right now" consumers (e.g. `FleetRunningSessionsPanel`) working unchanged.

## Non-Goals

- No multi-replica fleet server coordination — the server runs single-process per `fleetDir` and this design assumes that.
- No backfill from historical openclaw logs. History starts accumulating when the collector starts.
- No full-text search (FTS5). Plain `LIKE` is sufficient until it measurably hurts.
- No CSV export, per-user retention, or multi-tenant isolation.
- No changes to openclaw itself. The fleet server continues to consume the existing `sessions.list` API.
- No event-driven ingestion via openclaw WebSocket subscriptions.

## Architecture Overview

A new `SessionHistoryService` owns a SQLite database at `fleetDir/sessions.sqlite`. A new `SessionCollector` service runs in the background: on a fixed interval it asks each running instance for its recent sessions with a wide `activeMinutes` window, then upserts the results into the store keyed by `(instanceId, sessionKey)`. Each tick also prunes rows older than the retention window.

A new route `GET /api/fleet/sessions/history` serves filtered, paginated history from this store. The existing `GET /api/fleet/sessions` stays as-is for live "running now" consumers. On the web side, `FleetDashboardPanel` and the Activity panel migrate to the history endpoint. `FleetRunningSessionsPanel` and other live viewers keep the existing route. Filter state for Dashboard and Activity is moved out of `useState` and into URL search params via a small hook so filters are durable and shareable.

## Configuration

New `sessionHistory` section in `server.config.json`. All keys optional; defaults shown.

```json
{
  "sessionHistory": {
    "enabled": true,
    "retentionDays": 30,
    "collectIntervalMs": 30000,
    "activeMinutes": 180
  }
}
```

When `enabled` is `false` the collector never starts and the history route is not registered. `activeMinutes` controls the window passed to openclaw's `sessions.list`; it should be comfortably larger than `collectIntervalMs` so briefly-missed ticks still back-fill.

## Data Model

One SQLite table `sessions`. Primary key `(instance_id, session_key)`.

| column | type | notes |
|---|---|---|
| `instance_id` | TEXT NOT NULL | part of PK |
| `session_key` | TEXT NOT NULL | part of PK |
| `status` | TEXT NOT NULL | `running \| done \| failed \| killed \| timeout` |
| `started_at` | INTEGER | epoch ms, nullable |
| `ended_at` | INTEGER | epoch ms, nullable while running |
| `runtime_ms` | INTEGER | nullable |
| `model` | TEXT | nullable |
| `model_provider` | TEXT | nullable |
| `kind` | TEXT | nullable |
| `input_tokens` | INTEGER | nullable |
| `output_tokens` | INTEGER | nullable |
| `total_tokens` | INTEGER | nullable |
| `estimated_cost_usd` | REAL | nullable |
| `label` | TEXT | nullable |
| `display_name` | TEXT | nullable |
| `derived_title` | TEXT | nullable |
| `last_message_preview` | TEXT | nullable |
| `first_seen_at` | INTEGER NOT NULL | epoch ms of first collector capture |
| `last_seen_at` | INTEGER NOT NULL | epoch ms of last collector capture |
| `updated_at` | INTEGER NOT NULL | epoch ms of last DB write |

Indexes: `(last_seen_at DESC)`, `(started_at DESC)`, `(status, last_seen_at DESC)`, `(instance_id, last_seen_at DESC)`. These cover trend scans, Activity paged lists, status filtering, and instance drilldown respectively.

`previewItems` is not stored. The live preview flow remains on-demand via WebSocket when a user opens a session card.

**Terminal-status behavior:** once a row's status is `done | failed | killed | timeout`, the collector skips re-writing it on subsequent ticks. Rows that stay `running` but drop out of the live listing for two consecutive collection ticks are left untouched in the DB — we never invent a terminal status locally. They age out when the retention prune eventually removes them. The collector only ever writes statuses that came from openclaw itself.

## Server Components

### New files

- `packages/server/src/services/session-history.ts` — owns the `better-sqlite3` handle, schema migration, `upsertSessions()`, `listSessions(filter)`, `countSessions(filter)`, `pruneOlderThan(ms)`, `close()`.
- `packages/server/src/services/session-collector.ts` — `start(intervalMs)` and `stop()`. Holds references to the backend and the history service. Runs an immediate first tick on `start()`, then interval-scheduled ticks. Each tick uses `Promise.allSettled` so one bad instance cannot break the cycle.
- `packages/server/src/routes/sessions-history.ts` — `GET /api/fleet/sessions/history` with query-param validation and the admin guard.

### Bootstrap wiring

In `packages/server/src/index.ts`:

- If `sessionHistory.enabled`, construct `SessionHistoryService` and `SessionCollector` after the backend is ready, and start the collector.
- Register `/api/fleet/sessions/history` alongside the existing `/api/fleet/sessions` route.
- On graceful shutdown, stop the collector and close the DB handle.

### Dependencies

Add `better-sqlite3` and its `@types/better-sqlite3` to `packages/server/package.json`. Pinned version. Native build is acceptable — the fleet server already ships as a Node service.

### Migrations

Schema version is tracked via SQLite's `user_version` PRAGMA. `SessionHistoryService`'s constructor runs all migrations up to the latest version. For v1 this just creates the `sessions` table and its indexes.

## `/api/fleet/sessions/history` Endpoint

**Request:** `GET /api/fleet/sessions/history`

Query params (all optional):

| name | meaning |
|---|---|
| `from` | epoch ms lower bound on `last_seen_at` |
| `to` | epoch ms upper bound on `last_seen_at` |
| `status` | `running \| done \| failed \| killed \| timeout \| active \| error` — `active` means running (reuses the existing client bucket), `error` means `failed \| killed \| timeout` |
| `instanceId` | exact match |
| `q` | case-insensitive substring match over `session_key`, `display_name`, `derived_title`, `model`, `kind`, `last_message_preview` via `LIKE` |
| `limit` | default 200, max 1000 |
| `cursor` | opaque keyset cursor; internally `<last_seen_at>:<instance_id>:<session_key>` base64 |

**Response:**

```ts
{
  instances: Array<{
    instanceId: string;
    sessions: InstanceSessionRow[];
    error?: string;
  }>;
  updatedAt: number;
  nextCursor?: string;
  totalEstimate?: number;
}
```

The response groups by instance so the existing `buildFlatRows()` helper in `activityViewModel.ts` continues to work unchanged. `InstanceSessionRow` matches the existing schema. `error` is always absent on this route but remains in the type so client code stays consistent. `totalEstimate` is a plain `COUNT(*)` with the same filters (no cursor), used by the "shown / total" UI counter.

**Auth:** `requireAdmin` preHandler, matching the live route.

**Disabled state:** when `sessionHistory.enabled` is `false`, the route is not registered. The client treats a 404 as the signal to render a persistent inline notice on the Dashboard and Activity pages: "Session history is disabled in server config." No retry loop — the client stops hitting the endpoint until the page is reloaded.

## Web Changes

### `useUrlFilters` hook

New hook at `packages/web/src/hooks/useUrlFilters.ts`. Reads and writes `window.location.search`. Each filter has its own URL key so they compose. Writes use `history.replaceState` rather than `pushState` so tab clicks do not clutter history. The search-box filter (`q`) is debounced at 250ms. Values matching the default are not written to the URL, keeping the URL clean on the default view.

### URL param keys

| key | default | values |
|---|---|---|
| `status` | `all` | `all \| active \| done \| error` |
| `time` | `24h` | `today \| 24h \| 7d \| all` |
| `q` | `""` | free text |
| `focus` | `all` | `all \| running \| done \| failed \| killedTimeout \| other` |
| `instance` | unset | instance id |
| `trend` | `24h` | `24h \| 7d` |

### Panel updates

- `FleetDashboardPanel` — replace `useState` for `statusFilter`, `timeFilter`, `searchQuery`, `statusFocus`, and `trendWindow` (currently inside `Dashboard.tsx`) with `useUrlFilters`. Switch its `useFleetSessions()` call to a new `useFleetSessionsHistory()` hook that wraps the `/history` endpoint and shares a query key derived from the URL params.
- `FleetSessionsPanel` (the fleet-wide Activity page that renders `ActivityBoard` / table) — same migration. Reads the same URL keys so Dashboard and Activity stay in sync when the user switches between them.
- `FleetRunningSessionsPanel` and other live viewers — unchanged; keep using `useFleetSessions()`.
- `InstanceActivityTab` (per-instance Activity view inside an instance drawer) is out of scope for this migration and continues to use the live endpoint. It can adopt URL filters in a follow-up if desired.

### React Query key alignment

Query key becomes `['fleetSessionsHistory', { status, time, q, instance, cursor }]` so identical URLs share a cache entry. `refetchInterval: 15_000` stays. The existing `useFleetSessions()` hook remains for live consumers.

### What stays ephemeral

Auth state, selected-session modals, and scroll position are not written to the URL.

## Error Handling

- `SessionHistoryService` constructor: if SQLite open or migration fails, log and throw. Server startup fails loudly rather than silently running without persistence.
- `SessionCollector` tick: `Promise.allSettled` around per-instance fetches. Rejections logged at `warn`. Prune runs after upserts, inside its own try/catch — prune failures never block collection.
- `/api/fleet/sessions/history`: SQLite errors bubble up as 500 with a generic message; the actual error is logged server-side.
- `sessionHistory.enabled=false`: route not registered (returns 404). Client shows the disabled notice and falls back to existing behavior on the live endpoint where applicable.

## Edge Cases

- **Instance rename or removal:** rows stay in the DB with their original `instance_id`. The instance filter dropdown on the client is populated from distinct `instance_id`s in the history response, so it can legitimately list instances that no longer exist.
- **Clock skew between fleet server and openclaw:** `started_at` and `ended_at` come from openclaw. `first_seen_at` and `last_seen_at` come from the fleet server. Time-window filters key on `last_seen_at` so the Dashboard's trend remains internally consistent.
- **Collector after server restart:** the first tick runs immediately on start, not after `intervalMs`. Running sessions back-fill within the openclaw `activeMinutes` window.
- **DB file bloat:** retention prune keeps it bounded. `VACUUM` runs once per 24 hours of collector ticks.
- **Multi-replica fleet servers:** out of scope; single-process assumption is documented here.

## Testing Strategy

Tests (expanded in the implementation plan):

- `packages/server/tests/services/session-history.test.ts` — in-memory SQLite. Covers schema creation, upsert idempotence, terminal-status skip, prune, keyset pagination, LIKE search, count estimate.
- `packages/server/tests/services/session-collector.test.ts` — fake backend + fake history service. Covers one-bad-instance isolation, running-session-disappears reconciliation, prune invoked each tick, collector respects `enabled=false`.
- `packages/server/tests/routes/sessions-history.test.ts` — admin guard, query-param validation, pagination, 404 when disabled, response-shape parity with the live route.
- `packages/web/src/hooks/useUrlFilters.test.tsx` — read/write round-trip, default values omitted from URL, back/forward navigation, debounced `q`.
- `FleetDashboardPanel.test.tsx` and `FleetSessionsPanel.test.tsx` — assert URL-driven state and that they call the history endpoint.
- One Playwright spec in `tests/e2e/` that loads a URL with filters pre-applied, verifies the Dashboard renders accordingly, clicks a filter chip, and asserts the URL updates.

## Out of Scope (explicit)

FTS5 search, CSV export, per-user retention, multi-tenant isolation, WebSocket event streaming from openclaw, backfill from historical openclaw logs, multi-replica fleet-server coordination.
