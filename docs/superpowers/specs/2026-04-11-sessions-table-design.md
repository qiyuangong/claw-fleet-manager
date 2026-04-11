# Sessions Table Design

**Date:** 2026-04-11  
**Status:** Approved  
**Feature:** Enrich FleetSessionsPanel into a flat sortable table with stats bar and filters

## Overview

Replace the current grouped-by-instance card layout in `FleetSessionsPanel` with a stats bar, filter row, and a flat sortable table listing all sessions across all fleet instances. Matches the reference design at `tugcantopaloglu/openclaw-dashboard`.

## Goals

- Surface token counts and estimated cost per session
- Show all sessions in one scannable table, not per-instance cards
- Allow filtering by status (All / Active / Done / Error) and time range (Today / 24h / 7d / All)
- Allow sorting by Tokens, Cost, and Updated columns
- Keep the implementation client-side (no new API endpoints)

## Data Layer Changes

### `packages/server/src/services/openclaw-client.ts`

Expand `InstanceSessionRow` to include new fields returned by the openclaw gateway:

```typescript
export type InstanceSessionRow = {
  key: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  model?: string;
  modelProvider?: string;
  kind?: string;
  // New fields:
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
};
```

Update the `sessions.list` WS call to request derived titles and last message preview:

```typescript
const result = await request('sessions.list', {
  activeMinutes: 60,
  includeDerivedTitles: true,
  includeLastMessage: true,
});
```

### `packages/server/src/routes/sessions.ts`

Add new fields to the Fastify JSON schema for `InstanceSessionRow` items:

```json
"inputTokens":      { "type": "number" },
"outputTokens":     { "type": "number" },
"totalTokens":      { "type": "number" },
"estimatedCostUsd": { "type": "number" },
"updatedAt":        { "type": "number" }
```

### `packages/web/src/types.ts`

Mirror the server-side additions in the web `InstanceSessionRow` type.

## UI Design

### Stats Bar

Three summary chips computed client-side from the loaded data:

- **Sessions** — total count of all sessions across all instances
- **Tokens** — sum of `totalTokens`, formatted as `271k` / `1.2M` / raw number
- **Cost** — sum of `estimatedCostUsd`, formatted as `$0.00`. Shows `$—` when no session has cost data (e.g. free/local models).

### Filter Row

Two independent filter groups, both client-side (no extra API calls):

**Status tabs:** `All` | `Active` (status=running) | `Done` (status=done) | `Error` (status=failed/killed/timeout)

**Time-range tabs:** `Today` | `24h` | `7d` | `All`

Time filter applies against `updatedAt ?? endedAt ?? startedAt`. Default: All / All.

### Table

One row per session. Sorted newest-updated first by default. Columns:

| Column | Source | Notes |
|--------|--------|-------|
| Status | `status` | Colored dot: green=running, gray=done, red=error |
| Instance | `instanceId` | Clickable → `selectInstance()` |
| Session | `derivedTitle ?? label ?? key` | Truncated to 40 chars |
| Type | `kind` | Small pill badge |
| Model | `model` | Truncated to 20 chars |
| Tokens | `totalTokens` | Formatted (e.g. "12k"); `—` if absent |
| Cost | `estimatedCostUsd` | `$0.12`; `—` if absent |
| Last Message | `lastMessagePreview` | Truncated to 60 chars |
| Updated | `updatedAt ?? endedAt ?? startedAt` | Relative ("5m ago"); `—` if absent |

**Sortable columns:** Tokens, Cost, Updated (click header to toggle asc/desc).

**Empty state:** "No sessions match the current filters" when filters produce no results; "No active sessions" when the API returns nothing.

### Error Handling

- Per-instance fetch errors render as a single warning row spanning all columns: `⚠ openclaw-2: <error message>`
- Missing numeric fields (`totalTokens`, `estimatedCostUsd`) render as `—`; stats bar excludes absent values from sums (no NaN)
- Loading and top-level API errors behave as before

## Component Structure

```
FleetSessionsPanel          — owns filter state, sort state; computes flat row list; renders stats bar + filter row + SessionsTable
  SessionsTable             — receives flat [{instanceId, session}] rows; renders <table>; stateless
    SessionRow              — renders one <tr> with all 9 columns; stateless
```

Filter and sort logic lives in a `useMemo` inside `FleetSessionsPanel`. No new hooks.

## i18n

New keys needed in `en.ts` / `zh.ts`:

| Key | EN | ZH |
|-----|----|----|
| `sessions` | Sessions | 会话 |
| `tokens` | Tokens | Token 数 |
| `cost` | Cost | 费用 |
| `statusAll` | All | 全部 |
| `statusActive` | Active | 运行中 |
| `statusDone` | Done | 已完成 |
| `statusError` | Error | 出错 |
| `timeToday` | Today | 今天 |
| `time24h` | 24h | 24小时 |
| `time7d` | 7d | 7天 |
| `timeAll` | All | 全部 |
| `colInstance` | Instance | 实例 |
| `colSession` | Session | 会话 |
| `colType` | Type | 类型 |
| `colModel` | Model | 模型 |
| `colTokens` | Tokens | Token |
| `colCost` | Cost | 费用 |
| `colLastMessage` | Last Message | 最新消息 |
| `colUpdated` | Updated | 更新时间 |
| `noSessionsFilter` | No sessions match the current filters | 没有符合筛选条件的会话 |

## Styling

Uses existing CSS classes only (`panel-card`, `pill`, `muted`, `error-text`, `secondary-button`). No new stylesheets required.

## Out of Scope

- Gantt timeline visualization (Option C — deferred)
- Server-side filtering or pagination
- Session detail / message history view
- Real-time session subscriptions (page uses existing poll-on-refetch pattern)
