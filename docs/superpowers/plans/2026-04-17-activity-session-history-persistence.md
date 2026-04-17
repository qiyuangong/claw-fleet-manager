# Activity Session History Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist fleet session history on the server, expose it through a new admin history endpoint, and migrate the dashboard/activity UI to URL-backed filters without changing existing live-session consumers.

**Architecture:** Add a SQLite-backed `SessionHistoryService` plus a background `SessionCollector` that periodically snapshots live sessions from each running openclaw instance and prunes retained rows. Keep `/api/fleet/sessions` and `useFleetSessions()` untouched for live consumers, add `/api/fleet/sessions/history` and `useFleetSessionsHistory()` for persisted consumers, and move dashboard/activity filters into a shared URL-backed hook so refresh, navigation, and shared links preserve state.

**Tech Stack:** Fastify, better-sqlite3, React 19, React Query, Zustand, Vitest, Testing Library, Playwright, TypeScript

---

## File Map

| Action | Path | Purpose |
| --- | --- | --- |
| Create | `packages/server/src/services/session-history.ts` | SQLite schema/migrations, upsert/list/count/prune/close |
| Create | `packages/server/src/services/session-collector.ts` | Poll running instances, fan out safely, prune, VACUUM cadence |
| Create | `packages/server/src/routes/sessions-history.ts` | Admin history endpoint with filters + keyset pagination |
| Modify | `packages/server/src/config.ts` | Parse new `sessionHistory` config block |
| Modify | `packages/server/src/types.ts` | Add `SessionHistoryConfig` and `ServerConfig.sessionHistory` |
| Modify | `packages/server/server.config.example.json` | Document new defaults |
| Modify | `packages/server/src/index.ts` | Construct/start/stop history services and register route |
| Create | `packages/server/tests/services/session-history.test.ts` | DB behavior coverage |
| Create | `packages/server/tests/services/session-collector.test.ts` | Collector scheduling/fan-out/prune/VACUUM coverage |
| Create | `packages/server/tests/routes/sessions-history.test.ts` | Route/auth/filter/pagination/disabled coverage |
| Modify | `packages/server/package.json` | Add `better-sqlite3` and `@types/better-sqlite3` |
| Modify | `packages/web/src/types.ts` | Add persisted-history result types and cursor estimate fields |
| Modify | `packages/web/src/api/fleet.ts` | Add `/api/fleet/sessions/history` client helper |
| Create | `packages/web/src/hooks/useUrlFilters.ts` | Shared URL-backed filter state with debounced `q` |
| Create | `packages/web/src/hooks/useFleetSessionsHistory.ts` | React Query wrapper for history endpoint |
| Modify | `packages/web/src/components/instances/FleetDashboardPanel.tsx` | Use URL filters + history endpoint |
| Modify | `packages/web/src/components/instances/FleetSessionsPanel.tsx` | Use URL filters + history endpoint |
| Modify | `packages/web/src/components/instances/FleetSessionsPanel.test.tsx` | Assert URL-backed behavior + history hook usage |
| Create/Modify | `packages/web/src/components/instances/FleetDashboardPanel.test.tsx` | Assert URL-backed behavior + history hook usage |
| Create | `packages/web/src/hooks/useUrlFilters.test.tsx` | Hook-level URL sync coverage |
| Modify | `tests/e2e/ui-merge.spec.ts` or create focused spec under `tests/e2e/` | Filter pre-apply and URL update regression |

## Commit Plan

1. `docs: add activity session history persistence plan`
2. `feat(server): add session history storage and config`
3. `feat(server): add session history collector and route`
4. `feat(web): add URL-backed history hooks`
5. `feat(web): migrate dashboard and activity to persisted history`

## Task 1: Plan checkpoint

**Files:**
- Create: `docs/superpowers/plans/2026-04-17-activity-session-history-persistence.md`

- [ ] **Step 1.1: Add the plan document**

Create this plan file with the committed execution order, file map, validation gates, and commit boundaries.

- [ ] **Step 1.2: Commit the plan before implementation**

Run:

```bash
git add docs/superpowers/plans/2026-04-17-activity-session-history-persistence.md
git commit -m "docs: add activity session history persistence plan"
```

Expected: one plan-only commit on `worktree-activitypagelog`.

## Task 2: Session history storage and config

**Files:**
- Create: `packages/server/src/services/session-history.ts`
- Create: `packages/server/tests/services/session-history.test.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/types.ts`
- Modify: `packages/server/server.config.example.json`
- Modify: `packages/server/package.json`

- [ ] **Step 2.1: Add failing storage tests first**

Cover:
- schema migration via `PRAGMA user_version`
- idempotent upsert on `(instance_id, session_key)`
- terminal rows are not overwritten
- keyset pagination cursor ordering by `last_seen_at DESC, instance_id ASC, session_key ASC`
- `status` alias filtering (`active`, `error`)
- `LIKE` search across the spec-defined fields
- count estimate and prune behavior

- [ ] **Step 2.2: Run only the storage test file and verify RED**

Run:

```bash
cd packages/server && npx vitest run tests/services/session-history.test.ts
```

Expected: FAIL because `session-history.ts` does not exist yet.

- [ ] **Step 2.3: Add `better-sqlite3` dependency and config parsing**

Implement:
- `packages/server/package.json` dependency entries
- `SessionHistoryConfig` in `packages/server/src/types.ts`
- `sessionHistory` defaults in `packages/server/src/config.ts`
- documented example block in `packages/server/server.config.example.json`

- [ ] **Step 2.4: Implement `SessionHistoryService` minimally to satisfy the tests**

Include:
- DB file open from `fleetDir/sessions.sqlite`
- migration runner keyed by `user_version`
- prepared statements for upsert, list, count, prune
- terminal write skip for existing terminal rows
- opaque cursor encode/decode helper
- `close()`

- [ ] **Step 2.5: Re-run the focused storage test and verify GREEN**

Run:

```bash
cd packages/server && npx vitest run tests/services/session-history.test.ts
```

Expected: PASS.

- [ ] **Step 2.6: Install dependencies and verify workspace install**

Run:

```bash
npm install
```

Expected: PASS, including native `better-sqlite3` install.

- [ ] **Step 2.7: Run the server validation for this phase**

Run:

```bash
cd packages/server && npx vitest run tests/services/session-history.test.ts
```

Expected: PASS.

- [ ] **Step 2.8: Commit**

Run:

```bash
git add packages/server/package.json packages/server/src/types.ts packages/server/src/config.ts packages/server/server.config.example.json packages/server/src/services/session-history.ts packages/server/tests/services/session-history.test.ts package-lock.json
git commit -m "feat(server): add session history storage and config"
```

## Task 3: Collector, history route, and bootstrap wiring

**Files:**
- Create: `packages/server/src/services/session-collector.ts`
- Create: `packages/server/src/routes/sessions-history.ts`
- Create: `packages/server/tests/services/session-collector.test.ts`
- Create: `packages/server/tests/routes/sessions-history.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 3.1: Add failing collector tests first**

Cover:
- immediate first tick on `start()`
- interval scheduling at 30s default
- `Promise.allSettled` isolation when one instance fails
- pruning every tick
- VACUUM no more than once per 24 hours
- skip writes for terminal rows already terminal in DB
- disappearance of a running session does not invent a terminal status
- no-op when history disabled / no supported running instances

- [ ] **Step 3.2: Add failing route tests first**

Cover:
- admin-only access
- 404 when history route disabled/unregistered
- query validation for `from|to|status|instanceId|q|limit|cursor`
- grouped response shape `{ instances, updatedAt, nextCursor?, totalEstimate? }`
- cursor pagination

- [ ] **Step 3.3: Run the new collector/route tests and verify RED**

Run:

```bash
cd packages/server && npx vitest run tests/services/session-collector.test.ts tests/routes/sessions-history.test.ts
```

Expected: FAIL because the collector/route do not exist yet.

- [ ] **Step 3.4: Implement `SessionCollector`**

Implement:
- running openclaw instances only, respecting `runtimeCapabilities.sessions`
- `fetchInstanceSessions(..., { previewLimit: 0 })` with `activeMinutes` from config
- per-instance fan-out with `Promise.allSettled`
- per-tick prune
- daily VACUUM guard
- graceful `start()` / `stop()` semantics

- [ ] **Step 3.5: Implement `/api/fleet/sessions/history`**

Implement:
- query schema + normalization of status aliases
- `requireAdmin`
- grouped response preserving `InstanceSessionsEntry` shape
- `updatedAt` from request time
- `nextCursor` / `totalEstimate`

- [ ] **Step 3.6: Wire bootstrap and shutdown in `packages/server/src/index.ts`**

Implement:
- conditional service construction when `config.sessionHistory.enabled`
- route registration only when enabled
- collector start after backend initialization
- collector stop and DB close during shutdown

- [ ] **Step 3.7: Re-run focused tests and verify GREEN**

Run:

```bash
cd packages/server && npx vitest run tests/services/session-history.test.ts tests/services/session-collector.test.ts tests/routes/sessions-history.test.ts tests/routes/sessions.test.ts
```

Expected: PASS.

- [ ] **Step 3.8: Run phase validation**

Run:

```bash
cd packages/server && npx vitest run
```

Expected: PASS.

- [ ] **Step 3.9: Commit**

Run:

```bash
git add packages/server/src/services/session-collector.ts packages/server/src/routes/sessions-history.ts packages/server/src/index.ts packages/server/tests/services/session-collector.test.ts packages/server/tests/routes/sessions-history.test.ts
git commit -m "feat(server): add session history collector and route"
```

## Task 4: URL-backed web hooks and history API client

**Files:**
- Create: `packages/web/src/hooks/useUrlFilters.ts`
- Create: `packages/web/src/hooks/useUrlFilters.test.tsx`
- Create: `packages/web/src/hooks/useFleetSessionsHistory.ts`
- Modify: `packages/web/src/api/fleet.ts`
- Modify: `packages/web/src/types.ts`

- [ ] **Step 4.1: Add failing URL-filter tests first**

Cover:
- initial read from `window.location.search`
- default values omitted from URL
- `history.replaceState` writes
- debounced `q` update at 250 ms
- `popstate` re-hydration for back/forward

- [ ] **Step 4.2: Add a failing history-hook/API test or typed usage assertion**

Ensure `/api/fleet/sessions/history` query construction matches the spec and 404-disabled handling is representable.

- [ ] **Step 4.3: Run focused web tests and verify RED**

Run:

```bash
cd packages/web && npx vitest run src/hooks/useUrlFilters.test.tsx
```

Expected: FAIL because the new hooks do not exist yet.

- [ ] **Step 4.4: Implement shared URL filter state**

Implement:
- generic hook keyed by filter definitions
- support for `status`, `time`, `q`, `focus`, `instance`, `trend`
- replaceState writes only, no history push
- debounced search setter for `q`

- [ ] **Step 4.5: Implement `useFleetSessionsHistory()` and API/types**

Implement:
- query typing for `from|to|status|instanceId|q|limit|cursor`
- query key rooted at `['fleetSessionsHistory', ...]`
- 15s refetch with visibility gating
- disabled-state 404 surfaced distinctly so panels can stop retrying and render the config notice

- [ ] **Step 4.6: Re-run focused hook tests and verify GREEN**

Run:

```bash
cd packages/web && npx vitest run src/hooks/useUrlFilters.test.tsx
```

Expected: PASS.

- [ ] **Step 4.7: Run phase validation**

Run:

```bash
cd packages/web && npx vitest run src/hooks/useUrlFilters.test.tsx
cd packages/web && npm run build -- --mode test
```

Expected: PASS.

- [ ] **Step 4.8: Commit**

Run:

```bash
git add packages/web/src/hooks/useUrlFilters.ts packages/web/src/hooks/useUrlFilters.test.tsx packages/web/src/hooks/useFleetSessionsHistory.ts packages/web/src/api/fleet.ts packages/web/src/types.ts
git commit -m "feat(web): add URL-backed history hooks"
```

## Task 5: Migrate dashboard/activity panels and add browser coverage

**Files:**
- Modify: `packages/web/src/components/instances/FleetDashboardPanel.tsx`
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`
- Create/Modify: `packages/web/src/components/instances/FleetDashboardPanel.test.tsx`
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.test.tsx`
- Modify/Create: `tests/e2e/ui-merge.spec.ts` or dedicated history spec

- [ ] **Step 5.1: Add failing panel tests first**

Cover:
- dashboard/activity read filters from URL on first render
- both panels use `useFleetSessionsHistory()` rather than `useFleetSessions()`
- dashboard `trend` and `focus` are URL-backed
- reset clears non-default params from the URL
- disabled-history 404 renders the inline notice
- `FleetRunningSessionsPanel` and `InstanceActivityTab` remain untouched

- [ ] **Step 5.2: Add failing Playwright coverage first**

Cover:
- load page with pre-applied filter query params
- assert initial render reflects the URL
- click a filter control
- assert the URL updates in place

- [ ] **Step 5.3: Run focused panel/e2e tests and verify RED**

Run:

```bash
cd packages/web && npx vitest run src/components/instances/FleetDashboardPanel.test.tsx src/components/instances/FleetSessionsPanel.test.tsx
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 3001" npx playwright test --config tests/playwright.config.ts --grep "URL filter"
```

Expected: FAIL before implementation.

- [ ] **Step 5.4: Implement panel migration**

Implement:
- dashboard defaults per spec: `status=all`, `time=24h`, `q=''`, `focus=all`, `trend=24h`
- activity defaults per spec: `status=all`, `time=24h`, `q=''`, optional `instance`
- inline disabled notice on 404 from history endpoint
- preserve board/table and live panels outside scope

- [ ] **Step 5.5: Re-run focused panel/e2e tests and verify GREEN**

Run:

```bash
cd packages/web && npx vitest run src/components/instances/FleetDashboardPanel.test.tsx src/components/instances/FleetSessionsPanel.test.tsx src/hooks/useUrlFilters.test.tsx
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 3001" npx playwright test --config tests/playwright.config.ts --grep "URL filter"
```

Expected: PASS.

- [ ] **Step 5.6: Run full repo validation**

Run:

```bash
npm run lint
npm run test
npm run build
```

Expected: PASS on all three commands.

- [ ] **Step 5.7: Commit**

Run:

```bash
git add packages/web/src/components/instances/FleetDashboardPanel.tsx packages/web/src/components/instances/FleetSessionsPanel.tsx packages/web/src/components/instances/FleetDashboardPanel.test.tsx packages/web/src/components/instances/FleetSessionsPanel.test.tsx tests/e2e
git commit -m "feat(web): migrate dashboard and activity to persisted history"
```

## Task 6: Push branch

**Files:**
- No file changes

- [ ] **Step 6.1: Confirm worktree is clean after validation**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 6.2: Push the branch**

Run:

```bash
git -C /Users/qiyuangong/Develop/gitremote/claw-fleet-manager/.claude/worktrees/activitypagelog push origin worktree-activitypagelog
```

Expected: PASS, no PR creation.

## Self-Review

- Spec coverage:
  - server persistence, collector, history route, config, bootstrap, web hooks, panel migration, unchanged live consumers, and all requested tests are mapped to Tasks 2-5
- Placeholder scan:
  - no `TODO`, `TBD`, or “add tests later” gaps remain
- Commit boundaries:
  - plan, storage/config, collector/route, hooks/API, panel migration are isolated and match the requested logical chunking
