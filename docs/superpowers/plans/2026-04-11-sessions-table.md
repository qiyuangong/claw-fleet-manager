# Sessions Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grouped-card FleetSessionsPanel with a stats bar, filter row, and flat sortable table showing tokens, cost, last message, and updated time across all fleet instances.

**Architecture:** Expand the server `InstanceSessionRow` type and WS call to surface token/cost/preview data from the openclaw gateway, then rewrite the web panel into three stateless sub-components (stats bar, filter row, table) composed inside `FleetSessionsPanel` which owns filter and sort state.

**Tech Stack:** TypeScript, Fastify (server schema), React 19, react-i18next, vitest (server tests)

**Working directory:** All file paths are relative to the worktree root:
`.claude/worktrees/viewofinstancetask/` (branch `worktree-viewofinstancetask`)

---

## File Map

| File | Change |
|------|--------|
| `packages/server/src/services/openclaw-client.ts` | Expand `InstanceSessionRow` type; add `includeDerivedTitles`/`includeLastMessage` to `sessions.list` call |
| `packages/server/src/routes/sessions.ts` | Add new fields to Fastify JSON schema |
| `packages/server/tests/routes/sessions.test.ts` | Add new fields to mock; add passthrough test |
| `packages/web/src/types.ts` | Add new fields to web `InstanceSessionRow` type |
| `packages/web/src/i18n/locales/en.ts` | Add new i18n keys |
| `packages/web/src/i18n/locales/zh.ts` | Add new i18n keys |
| `packages/web/src/components/instances/FleetSessionsPanel.tsx` | Full rewrite: stats bar + filter row + flat sortable table |

---

## Task 1: Expand server-side InstanceSessionRow type and WS call

**Spec ref:** "Data Layer Changes → openclaw-client.ts"

**Files:**
- Modify: `packages/server/src/services/openclaw-client.ts`

- [ ] **Step 1: Update `InstanceSessionRow` type to include new fields**

In `packages/server/src/services/openclaw-client.ts`, replace the existing `InstanceSessionRow` type:

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
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
};
```

- [ ] **Step 2: Add `includeDerivedTitles` and `includeLastMessage` to the `sessions.list` WS call**

In `packages/server/src/services/openclaw-client.ts`, find the `sessions.list` request (currently around line 87–90) and update it:

```typescript
            const result = await request<{ sessions?: InstanceSessionRow[] }>(
              'sessions.list',
              { activeMinutes: 60, includeDerivedTitles: true, includeLastMessage: true },
            );
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/openclaw-client.ts
git commit -m "feat(server): expand InstanceSessionRow with tokens/cost/updatedAt fields"
```

---

## Task 2: Expand Fastify route schema + update test

**Spec ref:** "Data Layer Changes → sessions.ts route"

**Files:**
- Modify: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/tests/routes/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/server/tests/routes/sessions.test.ts`, update the mock inside `vi.mock(...)` to include new fields, then add one new test inside the `describe('as admin')` block:

```typescript
// Update the existing mock return value (top of file):
vi.mock('../../src/services/openclaw-client.js', () => ({
  fetchInstanceSessions: vi.fn().mockResolvedValue([
    {
      key: 'main',
      derivedTitle: 'Refactor auth',
      status: 'running',
      startedAt: Date.now() - 120_000,
      model: 'claude-opus-4',
      lastMessagePreview: 'Updated auth.ts.',
      totalTokens: 5000,
      estimatedCostUsd: 0.15,
      updatedAt: Date.now() - 10_000,
    },
  ]),
}));
```

Add this test inside `describe('as admin')`:

```typescript
    it('passes through token and cost fields from fetchInstanceSessions', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/fleet/sessions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ instances: { instanceId: string; sessions: { totalTokens?: number; estimatedCostUsd?: number; updatedAt?: number }[] }[] }>();
      const session = body.instances[0].sessions[0];
      expect(session.totalTokens).toBe(5000);
      expect(session.estimatedCostUsd).toBe(0.15);
      expect(session.updatedAt).toBeGreaterThan(0);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/server && npx vitest run tests/routes/sessions.test.ts
```

Expected: the new test fails because the route's JSON schema strips unknown fields.

- [ ] **Step 3: Update the Fastify JSON schema in `packages/server/src/routes/sessions.ts`**

Inside `fleetSessionsResponseSchema`, find the `properties` block for session items and add the new fields:

```typescript
                key: { type: 'string' },
                label: { type: 'string' },
                displayName: { type: 'string' },
                derivedTitle: { type: 'string' },
                lastMessagePreview: { type: 'string' },
                status: { type: 'string', enum: ['running', 'done', 'failed', 'killed', 'timeout'] },
                startedAt: { type: 'number' },
                endedAt: { type: 'number' },
                runtimeMs: { type: 'number' },
                model: { type: 'string' },
                modelProvider: { type: 'string' },
                kind: { type: 'string' },
                inputTokens: { type: 'number' },
                outputTokens: { type: 'number' },
                totalTokens: { type: 'number' },
                estimatedCostUsd: { type: 'number' },
                updatedAt: { type: 'number' },
```

- [ ] **Step 4: Run the test again to verify it passes**

```bash
cd packages/server && npx vitest run tests/routes/sessions.test.ts
```

Expected: all tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/sessions.ts packages/server/tests/routes/sessions.test.ts
git commit -m "feat(server): expose token/cost/updatedAt fields in sessions route schema"
```

---

## Task 3: Update web types + add i18n keys

**Spec ref:** "Data Layer Changes → web/src/types.ts" and "i18n"

**Files:**
- Modify: `packages/web/src/types.ts`
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`

- [ ] **Step 1: Add new fields to `InstanceSessionRow` in `packages/web/src/types.ts`**

Replace the existing `InstanceSessionRow` type:

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
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  updatedAt?: number;
};
```

- [ ] **Step 2: Add new i18n keys to `packages/web/src/i18n/locales/en.ts`**

Insert the following block after the existing sessions keys (`loadingSessions`, `refresh`, etc.) — find the comment `// Instance Panel` and insert before it:

```typescript
  // Sessions Table
  sessionsCount: 'Sessions',
  tokens: 'Tokens',
  cost: 'Cost',
  statusFilterAll: 'All',
  statusFilterActive: 'Active',
  statusFilterDone: 'Done',
  statusFilterError: 'Error',
  timeFilterToday: 'Today',
  timeFilter24h: '24h',
  timeFilter7d: '7d',
  timeFilterAll: 'All',
  colInstance: 'Instance',
  colSession: 'Session',
  colType: 'Type',
  colModel: 'Model',
  colTokens: 'Tokens',
  colCost: 'Cost',
  colLastMessage: 'Last Message',
  colUpdated: 'Updated',
  noSessionsFilter: 'No sessions match the current filters.',
```

- [ ] **Step 3: Add new i18n keys to `packages/web/src/i18n/locales/zh.ts`**

Insert the matching block in the same position (after sessions keys, before `// Instance Panel`):

```typescript
  // Sessions Table
  sessionsCount: '会话',
  tokens: 'Token 数',
  cost: '费用',
  statusFilterAll: '全部',
  statusFilterActive: '运行中',
  statusFilterDone: '已完成',
  statusFilterError: '出错',
  timeFilterToday: '今天',
  timeFilter24h: '24小时',
  timeFilter7d: '7天',
  timeFilterAll: '全部',
  colInstance: '实例',
  colSession: '会话',
  colType: '类型',
  colModel: '模型',
  colTokens: 'Token',
  colCost: '费用',
  colLastMessage: '最新消息',
  colUpdated: '更新时间',
  noSessionsFilter: '没有符合筛选条件的会话。',
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/types.ts packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts
git commit -m "feat(web): add token/cost/updatedAt fields and sessions table i18n keys"
```

---

## Task 4: Rewrite FleetSessionsPanel with stats bar, filter row, and flat table

**Spec ref:** "UI Design" — stats bar, filter row, table with 9 columns

**Files:**
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`

- [ ] **Step 1: Replace the full file with the new implementation**

```typescript
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store';
import { useFleetSessions } from '../../hooks/useFleetSessions';
import type { InstanceSessionRow, InstanceSessionsEntry } from '../../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

function formatTokens(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function formatCost(n: number | undefined): string {
  if (n == null) return '$—';
  return `$${n.toFixed(2)}`;
}

function sessionTimestamp(session: InstanceSessionRow): number | undefined {
  return session.updatedAt ?? session.endedAt ?? session.startedAt;
}

function formatRelative(ts: number | undefined): string {
  if (ts == null) return '—';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── filter types ────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'done' | 'error';
type TimeFilter = 'today' | '24h' | '7d' | 'all';
type SortCol = 'tokens' | 'cost' | 'updated';
type SortDir = 'asc' | 'desc';

function statusMatches(session: InstanceSessionRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return session.status === 'running';
  if (filter === 'done') return session.status === 'done';
  if (filter === 'error') return session.status === 'failed' || session.status === 'killed' || session.status === 'timeout';
  return true;
}

function timeMatches(session: InstanceSessionRow, filter: TimeFilter): boolean {
  if (filter === 'all') return true;
  const ts = sessionTimestamp(session);
  if (ts == null) return false;
  const now = Date.now();
  if (filter === 'today') {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return ts >= startOfDay.getTime();
  }
  if (filter === '24h') return ts >= now - 86_400_000;
  if (filter === '7d') return ts >= now - 7 * 86_400_000;
  return true;
}

// ─── flat row type ────────────────────────────────────────────────────────────

type FlatRow = { instanceId: string; session: InstanceSessionRow };

function buildFlatRows(instances: InstanceSessionsEntry[]): FlatRow[] {
  return instances.flatMap((entry) =>
    entry.sessions.map((session) => ({ instanceId: entry.instanceId, session }))
  );
}

// ─── SessionRow component ────────────────────────────────────────────────────

function SessionRow({ instanceId, session, onSelectInstance }: {
  instanceId: string;
  session: InstanceSessionRow;
  onSelectInstance: (id: string) => void;
}) {
  const statusDotClass =
    session.status === 'running' ? 'status-dot--running' :
    session.status === 'done' ? 'status-dot--done' :
    session.status != null ? 'status-dot--error' : 'status-dot--none';

  return (
    <tr className="session-table-row">
      <td><span className={`status-dot ${statusDotClass}`} /></td>
      <td>
        <button
          className="link-button"
          onClick={() => onSelectInstance(instanceId)}
        >
          {instanceId}
        </button>
      </td>
      <td title={sessionTitle(session)}>{truncate(sessionTitle(session), 40)}</td>
      <td>{session.kind ? <span className="pill pill--sm">{session.kind}</span> : '—'}</td>
      <td className="muted">{session.model ? truncate(session.model, 20) : '—'}</td>
      <td className="col-numeric">{formatTokens(session.totalTokens)}</td>
      <td className="col-numeric">{formatCost(session.estimatedCostUsd)}</td>
      <td className="muted col-preview">{session.lastMessagePreview ? truncate(session.lastMessagePreview, 60) : '—'}</td>
      <td className="muted col-numeric">{formatRelative(sessionTimestamp(session))}</td>
    </tr>
  );
}

// ─── SessionsTable component ──────────────────────────────────────────────────

function SessionsTable({ rows, onSelectInstance, sortCol, sortDir, onSort }: {
  rows: FlatRow[];
  onSelectInstance: (id: string) => void;
  sortCol: SortCol | null;
  sortDir: SortDir;
  onSort: (col: SortCol) => void;
}) {
  const { t } = useTranslation();

  function SortHeader({ col, label }: { col: SortCol; label: string }) {
    const active = sortCol === col;
    return (
      <th
        className={`sortable-th${active ? ' sortable-th--active' : ''}`}
        onClick={() => onSort(col)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <div className="sessions-table-wrap">
      <table className="sessions-table">
        <thead>
          <tr>
            <th style={{ width: '1.5rem' }} />
            <th>{t('colInstance')}</th>
            <th>{t('colSession')}</th>
            <th>{t('colType')}</th>
            <th>{t('colModel')}</th>
            <SortHeader col="tokens" label={t('colTokens')} />
            <SortHeader col="cost" label={t('colCost')} />
            <th>{t('colLastMessage')}</th>
            <SortHeader col="updated" label={t('colUpdated')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SessionRow
              key={`${row.instanceId}:${row.session.key}`}
              instanceId={row.instanceId}
              session={row.session}
              onSelectInstance={onSelectInstance}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── FleetSessionsPanel ───────────────────────────────────────────────────────

export function FleetSessionsPanel() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch, isFetching } = useFleetSessions();
  const selectInstance = useAppStore((state) => state.selectInstance);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  // Stats
  const allRows = useMemo(() => buildFlatRows(data?.instances ?? []), [data]);
  const totalTokens = useMemo(
    () => allRows.reduce((sum, r) => sum + (r.session.totalTokens ?? 0), 0),
    [allRows],
  );
  const totalCost = useMemo(
    () => allRows.reduce((sum, r) => sum + (r.session.estimatedCostUsd ?? 0), 0),
    [allRows],
  );

  // Filtered + sorted rows
  const filteredRows = useMemo(() => {
    let rows = allRows.filter(
      (r) => statusMatches(r.session, statusFilter) && timeMatches(r.session, timeFilter),
    );

    if (sortCol === 'tokens') {
      rows = [...rows].sort((a, b) => {
        const diff = (a.session.totalTokens ?? -1) - (b.session.totalTokens ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else if (sortCol === 'cost') {
      rows = [...rows].sort((a, b) => {
        const diff = (a.session.estimatedCostUsd ?? -1) - (b.session.estimatedCostUsd ?? -1);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else if (sortCol === 'updated') {
      rows = [...rows].sort((a, b) => {
        const diff = (sessionTimestamp(a.session) ?? 0) - (sessionTimestamp(b.session) ?? 0);
        return sortDir === 'asc' ? diff : -diff;
      });
    } else {
      // Default: newest-updated first
      rows = [...rows].sort(
        (a, b) => (sessionTimestamp(b.session) ?? 0) - (sessionTimestamp(a.session) ?? 0),
      );
    }

    return rows;
  }, [allRows, statusFilter, timeFilter, sortCol, sortDir]);

  // Error rows from instances that failed to fetch
  const errorEntries = useMemo(
    () => (data?.instances ?? []).filter((e) => !!e.error),
    [data],
  );

  const STATUS_FILTERS: { key: StatusFilter; labelKey: string }[] = [
    { key: 'all', labelKey: 'statusFilterAll' },
    { key: 'active', labelKey: 'statusFilterActive' },
    { key: 'done', labelKey: 'statusFilterDone' },
    { key: 'error', labelKey: 'statusFilterError' },
  ];

  const TIME_FILTERS: { key: TimeFilter; labelKey: string }[] = [
    { key: 'today', labelKey: 'timeFilterToday' },
    { key: '24h', labelKey: 'timeFilter24h' },
    { key: '7d', labelKey: 'timeFilter7d' },
    { key: 'all', labelKey: 'timeFilterAll' },
  ];

  return (
    <div className="field-grid">
      <section className="panel-card">
        {/* Header */}
        <div className="panel-header">
          <div>
            <h2 style={{ margin: 0 }}>{t('activeSessions')}</h2>
          </div>
          <button
            className="secondary-button"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : t('refresh')}
          </button>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="sessions-stats-bar">
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('sessionsCount')}</span>
              <span className="sessions-stat-value">{allRows.length}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('tokens')}</span>
              <span className="sessions-stat-value">{formatTokens(totalTokens || undefined)}</span>
            </span>
            <span className="sessions-stat">
              <span className="sessions-stat-label">{t('cost')}</span>
              <span className="sessions-stat-value">{formatCost(totalCost || undefined)}</span>
            </span>
          </div>
        )}

        {/* Filter row */}
        {data && (
          <div className="sessions-filter-row">
            <div className="filter-tabs">
              {STATUS_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  className={`filter-tab${statusFilter === key ? ' filter-tab--active' : ''}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {t(labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
            <div className="filter-tabs">
              {TIME_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  className={`filter-tab${timeFilter === key ? ' filter-tab--active' : ''}`}
                  onClick={() => setTimeFilter(key)}
                >
                  {t(labelKey as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {isLoading ? (
          <p className="muted">{t('loadingSessions')}</p>
        ) : error ? (
          <p className="error-text">{(error as Error).message}</p>
        ) : !data || allRows.length === 0 ? (
          <p className="muted">{t('noActiveSessions')}</p>
        ) : (
          <>
            {errorEntries.map((entry) => (
              <p key={entry.instanceId} className="error-text" style={{ fontSize: '0.85rem' }}>
                ⚠ {entry.instanceId}: {entry.error}
              </p>
            ))}
            {filteredRows.length === 0 ? (
              <p className="muted">{t('noSessionsFilter')}</p>
            ) : (
              <SessionsTable
                rows={filteredRows}
                onSelectInstance={selectInstance}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit the component** (CSS is applied in Task 5)

```bash
git -C .claude/worktrees/viewofinstancetask add packages/web/src/components/instances/FleetSessionsPanel.tsx
git -C .claude/worktrees/viewofinstancetask commit -m "feat(web): rewrite FleetSessionsPanel as sortable sessions table with stats bar and filters"
```

---

## Task 5: CSS file discovery and apply styles

**Note:** This task is only needed if Task 4 Step 2 showed the CSS file is somewhere specific. The grep command will tell you exactly which `.css` file to edit.

**Files:**
- Modify: whichever `.css` file the grep finds (likely `packages/web/src/index.css` or `packages/web/src/App.css`)

- [ ] **Step 1: Run the grep from Task 4 Step 2 to find the CSS file**

```bash
grep -rn "session-row\|panel-card\|status-badge" .claude/worktrees/viewofinstancetask/packages/web/src/ --include="*.css" -l
```

- [ ] **Step 2: Append the CSS block to the found file**

Open the file found above and append the CSS block from Task 4 Step 2 at the end of the file.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): add sessions table CSS"
```

---

## Task 6: Spec compliance review

Run the tests and verify spec coverage.

- [ ] **Step 1: Run server tests**

```bash
cd .claude/worktrees/viewofinstancetask/packages/server && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Verify spec checklist**

Read `docs/superpowers/specs/2026-04-11-sessions-table-design.md` and confirm:

| Spec requirement | Status |
|-----------------|--------|
| `InstanceSessionRow` expanded with 5 new fields | Task 1 |
| `includeDerivedTitles` + `includeLastMessage` in WS call | Task 1 |
| Fastify schema updated | Task 2 |
| Test for new fields passes | Task 2 |
| Web type updated | Task 3 |
| i18n keys added (en + zh) | Task 3 |
| Stats bar (sessions, tokens, cost) | Task 4 |
| Status filter tabs (All/Active/Done/Error) | Task 4 |
| Time filter tabs (Today/24h/7d/All) | Task 4 |
| Flat table with 9 columns | Task 4 |
| Sortable Tokens, Cost, Updated columns | Task 4 |
| Per-instance error rows | Task 4 |
| Empty state (no data / no filter match) | Task 4 |
| CSS for new elements | Task 5 |

- [ ] **Step 3: Fix any gaps found, then commit fixes**

```bash
git add -p
git commit -m "fix(web): sessions table spec compliance fixes"
```
