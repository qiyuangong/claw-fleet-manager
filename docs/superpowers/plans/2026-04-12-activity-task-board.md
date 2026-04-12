# Activity Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a board view to the admin Activity page, keep the existing table view, and make the page easier to scan on large fleets without changing backend behavior.

**Architecture:** Keep `FleetSessionsPanel` as the Activity container, but split presentation into a new `ActivityBoard` component and the existing table component. Move filtering, sorting, and board-grouping logic into a small shared view-model module so both views consume the same transformed session data.

**Tech Stack:** React 19, TypeScript, Zustand, React Query, i18next, Vitest, Testing Library, Playwright

---

## File Structure

- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`
  - Convert the current Activity page into a composition container with a `Board / Table` toggle.
- Create: `packages/web/src/components/instances/ActivityBoard.tsx`
  - Render status columns, card headers, empty-column states, and per-card navigation.
- Create: `packages/web/src/components/instances/activityViewModel.ts`
  - Hold shared Activity helpers for filtering, sorting, grouping, and summary calculations.
- Create: `packages/web/src/components/instances/activityViewModel.test.ts`
  - Verify grouping, filtering, and sort behavior without UI noise.
- Create: `packages/web/src/components/instances/FleetSessionsPanel.test.tsx`
  - Verify the board/table toggle, board rendering, and card navigation.
- Create: `packages/web/src/test/setup.ts`
  - Register `@testing-library/jest-dom` for component tests.
- Modify: `packages/web/vite.config.ts`
  - Add Vitest `test` config with `jsdom` and the new setup file.
- Modify: `packages/web/src/i18n/locales/en.ts`
  - Add board and toggle labels.
- Modify: `packages/web/src/i18n/locales/zh.ts`
  - Add board and toggle labels in Chinese.
- Modify: `packages/web/src/index.css`
  - Add board layout, card, and segmented-toggle styling.
- Modify: `tests/e2e/ui-merge.spec.ts`
  - Extend the dashboard fixture to mock `/api/fleet/sessions` and add Activity board coverage.

### Task 1: Extract the Activity view model

**Files:**
- Create: `packages/web/src/components/instances/activityViewModel.ts`
- Create: `packages/web/src/components/instances/activityViewModel.test.ts`

- [ ] **Step 1: Write the failing helper test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildBoardColumns,
  buildFlatRows,
  filterRows,
  sortRows,
  summarizeRows,
  type FlatRow,
} from './activityViewModel';

const now = new Date('2026-04-12T10:00:00Z').getTime();

const rows: FlatRow[] = [
  {
    instanceId: 'alpha',
    session: {
      key: 'run-1',
      derivedTitle: 'Running task',
      status: 'running',
      totalTokens: 1200,
      estimatedCostUsd: 1.25,
      updatedAt: now - 5_000,
    },
  },
  {
    instanceId: 'beta',
    session: {
      key: 'done-1',
      derivedTitle: 'Finished task',
      status: 'done',
      totalTokens: 800,
      updatedAt: now - 60_000,
    },
  },
  {
    instanceId: 'gamma',
    session: {
      key: 'fail-1',
      derivedTitle: 'Broken task',
      status: 'failed',
      totalTokens: 20,
      updatedAt: now - 120_000,
    },
  },
  {
    instanceId: 'delta',
    session: {
      key: 'timeout-1',
      derivedTitle: 'Timed out task',
      status: 'timeout',
      updatedAt: now - 240_000,
    },
  },
];

describe('activityViewModel', () => {
  it('groups rows into board columns with killed and timeout merged', () => {
    const columns = buildBoardColumns(rows);
    expect(columns.map((column) => [column.key, column.rows.length])).toEqual([
      ['running', 1],
      ['done', 1],
      ['failed', 1],
      ['killedTimeout', 1],
    ]);
  });

  it('filters rows by status and time', () => {
    expect(filterRows(rows, 'active', 'all', now)).toHaveLength(1);
    expect(filterRows(rows, 'error', '24h', now)).toHaveLength(2);
  });

  it('sorts rows by updated descending by default', () => {
    expect(sortRows(rows, null, 'desc')[0]?.session.key).toBe('run-1');
    expect(sortRows(rows, 'tokens', 'desc')[0]?.session.key).toBe('run-1');
  });

  it('summarizes tokens and cost without NaN', () => {
    expect(summarizeRows(rows)).toEqual({
      totalSessions: 4,
      totalTokens: 2020,
      totalCost: 1.25,
      hasCostData: true,
    });
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/activityViewModel.test.ts
```

Expected: FAIL with `Cannot find module './activityViewModel'` or missing export errors for `buildBoardColumns`, `filterRows`, `sortRows`, and `summarizeRows`.

- [ ] **Step 3: Write the minimal shared view-model implementation**

```ts
import type { InstanceSessionRow, InstanceSessionsEntry } from '../../types';

export type StatusFilter = 'all' | 'active' | 'done' | 'error';
export type TimeFilter = 'today' | '24h' | '7d' | 'all';
export type SortCol = 'tokens' | 'cost' | 'updated';
export type SortDir = 'asc' | 'desc';
export type ActivityViewMode = 'board' | 'table';

export type FlatRow = { instanceId: string; session: InstanceSessionRow };

export type BoardColumnKey = 'running' | 'done' | 'failed' | 'killedTimeout' | 'other';

export type BoardColumn = {
  key: BoardColumnKey;
  rows: FlatRow[];
};

export function buildFlatRows(instances: InstanceSessionsEntry[]): FlatRow[] {
  return instances.flatMap((entry) =>
    entry.sessions.map((session) => ({ instanceId: entry.instanceId, session })),
  );
}

export function sessionTitle(session: InstanceSessionRow): string {
  return session.derivedTitle ?? session.label ?? session.key;
}

export function sessionTimestamp(session: InstanceSessionRow): number | undefined {
  return session.updatedAt ?? session.endedAt ?? session.startedAt;
}

export function formatTokens(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatCost(n: number | undefined): string {
  if (n == null) return '$—';
  return `$${n.toFixed(2)}`;
}

export function formatRelative(ts: number | undefined, now = Date.now()): string {
  if (ts == null) return '—';
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function filterRows(rows: FlatRow[], status: StatusFilter, time: TimeFilter, now = Date.now()): FlatRow[] {
  return rows.filter((row) => statusMatches(row.session, status) && timeMatches(row.session, time, now));
}

export function sortRows(rows: FlatRow[], sortCol: SortCol | null, sortDir: SortDir): FlatRow[] {
  const copy = [...rows];
  if (sortCol === 'tokens') {
    return copy.sort((a, b) => compare((a.session.totalTokens ?? -1), (b.session.totalTokens ?? -1), sortDir));
  }
  if (sortCol === 'cost') {
    return copy.sort((a, b) => compare((a.session.estimatedCostUsd ?? -1), (b.session.estimatedCostUsd ?? -1), sortDir));
  }
  return copy.sort((a, b) => compare((sessionTimestamp(a.session) ?? 0), (sessionTimestamp(b.session) ?? 0), sortCol === 'updated' ? sortDir : 'desc'));
}

export function buildBoardColumns(rows: FlatRow[]): BoardColumn[] {
  const grouped: Record<BoardColumnKey, FlatRow[]> = {
    running: [],
    done: [],
    failed: [],
    killedTimeout: [],
    other: [],
  };
  for (const row of rows) grouped[columnKeyForStatus(row.session.status)].push(row);
  return (Object.entries(grouped) as [BoardColumnKey, FlatRow[]][])
    .filter(([key, value]) => key !== 'other' || value.length > 0)
    .map(([key, value]) => ({ key, rows: value }));
}

export function summarizeRows(rows: FlatRow[]) {
  return {
    totalSessions: rows.length,
    totalTokens: rows.reduce((sum, row) => sum + (row.session.totalTokens ?? 0), 0),
    totalCost: rows.reduce((sum, row) => sum + (row.session.estimatedCostUsd ?? 0), 0),
    hasCostData: rows.some((row) => row.session.estimatedCostUsd != null),
  };
}

export function columnLabelKey(column: BoardColumnKey): string {
  if (column === 'running') return 'activityBoardRunning';
  if (column === 'done') return 'activityBoardDone';
  if (column === 'failed') return 'activityBoardFailed';
  if (column === 'killedTimeout') return 'activityBoardKilledTimeout';
  return 'activityBoardOther';
}

function columnKeyForStatus(status: InstanceSessionRow['status']): BoardColumnKey {
  if (status === 'running') return 'running';
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'killed' || status === 'timeout') return 'killedTimeout';
  return 'other';
}

function statusMatches(session: InstanceSessionRow, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return session.status === 'running';
  if (filter === 'done') return session.status === 'done';
  return session.status === 'failed' || session.status === 'killed' || session.status === 'timeout';
}

function timeMatches(session: InstanceSessionRow, filter: TimeFilter, now: number): boolean {
  if (filter === 'all') return true;
  const ts = sessionTimestamp(session);
  if (ts == null) return false;
  if (filter === 'today') {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    return ts >= startOfDay.getTime();
  }
  if (filter === '24h') return ts >= now - 86_400_000;
  if (filter === '7d') return ts >= now - 7 * 86_400_000;
  return true;
}

function compare(a: number, b: number, sortDir: SortDir): number {
  const diff = a - b;
  return sortDir === 'asc' ? diff : -diff;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/activityViewModel.test.ts
```

Expected: PASS with 4 tests green in `activityViewModel.test.ts`.

- [ ] **Step 5: Commit the helper extraction**

```bash
git add packages/web/src/components/instances/activityViewModel.ts packages/web/src/components/instances/activityViewModel.test.ts
git commit -m "test: add activity view model coverage"
```

### Task 2: Add component test coverage and the board UI shell

**Files:**
- Modify: `packages/web/vite.config.ts`
- Create: `packages/web/src/test/setup.ts`
- Create: `packages/web/src/components/instances/ActivityBoard.tsx`
- Create: `packages/web/src/components/instances/FleetSessionsPanel.test.tsx`
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetSessionsPanel } from './FleetSessionsPanel';
import { useAppStore } from '../../store';
import '../../i18n';

vi.mock('../../hooks/useFleetSessions', () => ({
  useFleetSessions: () => ({
    data: {
      instances: [
        {
          instanceId: 'alpha',
          sessions: [
            {
              key: 'run-1',
              derivedTitle: 'Running task',
              status: 'running',
              model: 'gpt-5.4',
              kind: 'chat',
              totalTokens: 1200,
              estimatedCostUsd: 1.25,
              lastMessagePreview: 'Working on it',
              updatedAt: Date.now(),
            },
          ],
        },
      ],
      updatedAt: Date.now(),
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

describe('FleetSessionsPanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: { type: 'sessions' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });
  });

  it('renders board mode by default and navigates from a card', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <FleetSessionsPanel />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Running')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'alpha' }));
    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'alpha' });
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/FleetSessionsPanel.test.tsx
```

Expected: FAIL because Vitest is not yet configured for `jsdom`, and after that is fixed the test should still fail because the `Board` toggle and board rendering do not exist.

- [ ] **Step 3: Add test setup and implement the board shell**

```ts
// packages/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
        secure: false,
      },
      '/ws': {
        target: backendTarget,
        ws: true,
        secure: false,
      },
      '/proxy': {
        target: backendTarget,
        ws: true,
        secure: false,
        changeOrigin: false,
      },
    },
  },
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
```

```ts
// packages/web/src/test/setup.ts
import '@testing-library/jest-dom/vitest';
```

```tsx
// packages/web/src/components/instances/ActivityBoard.tsx
import { useTranslation } from 'react-i18next';
import {
  columnLabelKey,
  formatCost,
  formatRelative,
  formatTokens,
  sessionTimestamp,
  sessionTitle,
  type BoardColumn,
} from './activityViewModel';

export function ActivityBoard({
  columns,
  errors,
  onSelectInstance,
}: {
  columns: BoardColumn[];
  errors: { instanceId: string; error: string }[];
  onSelectInstance: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="activity-board-shell">
      {errors.length > 0 ? (
        <div className="activity-board-errors">
          {errors.map((entry) => (
            <p key={entry.instanceId} className="activity-board-error">
              {entry.instanceId}: {entry.error}
            </p>
          ))}
        </div>
      ) : null}
      <div className="activity-board-grid">
        {columns.map((column) => (
          <section key={column.key} className={`activity-column activity-column--${column.key}`}>
            <header className="activity-column-header">
              <h3>{t(columnLabelKey(column.key))}</h3>
              <span>{column.rows.length}</span>
            </header>
            {column.rows.length === 0 ? (
              <div className="activity-column-empty">{t('activityBoardEmptyColumn')}</div>
            ) : (
              column.rows.map((row) => (
                <article key={`${row.instanceId}:${row.session.key}`} className="activity-card">
                  <div className="activity-card-top">
                    <h4>{sessionTitle(row.session)}</h4>
                    <span>{formatRelative(sessionTimestamp(row.session))}</span>
                  </div>
                  <button className="link-button" onClick={() => onSelectInstance(row.instanceId)}>
                    {row.instanceId}
                  </button>
                  <div className="activity-card-meta">
                    {row.session.kind ? <span className="pill pill--sm">{row.session.kind}</span> : null}
                    {row.session.model ? <span className="pill pill--sm">{row.session.model}</span> : null}
                  </div>
                  <div className="activity-card-stats">
                    <span>{formatTokens(row.session.totalTokens)}</span>
                    <span>{formatCost(row.session.estimatedCostUsd)}</span>
                  </div>
                  <p className="activity-card-preview">{row.session.lastMessagePreview ?? '—'}</p>
                </article>
              ))
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
```

```tsx
// packages/web/src/components/instances/FleetSessionsPanel.tsx
const [viewMode, setViewMode] = useState<ActivityViewMode>('board');
const allRows = useMemo(() => buildFlatRows(data?.instances ?? []), [data]);
const filteredRows = useMemo(() => filterRows(allRows, statusFilter, timeFilter), [allRows, statusFilter, timeFilter]);
const sortedRows = useMemo(() => sortRows(filteredRows, sortCol, sortDir), [filteredRows, sortCol, sortDir]);
const boardColumns = useMemo(() => buildBoardColumns(filteredRows), [filteredRows]);

<div className="activity-toolbar">
  <div className="activity-view-toggle" role="group" aria-label={t('activityViewLabel')}>
    <button
      className={`activity-view-button${viewMode === 'board' ? ' activity-view-button--active' : ''}`}
      aria-pressed={viewMode === 'board'}
      onClick={() => setViewMode('board')}
    >
      {t('activityViewBoard')}
    </button>
    <button
      className={`activity-view-button${viewMode === 'table' ? ' activity-view-button--active' : ''}`}
      aria-pressed={viewMode === 'table'}
      onClick={() => setViewMode('table')}
    >
      {t('activityViewTable')}
    </button>
  </div>
</div>

{viewMode === 'board' ? (
  <ActivityBoard
    columns={boardColumns}
    errors={errorEntries.map((entry) => ({ instanceId: entry.instanceId, error: entry.error ?? '' }))}
    onSelectInstance={selectInstance}
  />
) : (
  <SessionsTable
    rows={sortedRows}
    errors={errorEntries.map((entry) => ({ instanceId: entry.instanceId, error: entry.error ?? '' }))}
    onSelectInstance={selectInstance}
    sortCol={sortCol}
    sortDir={sortDir}
    onSort={handleSort}
  />
)}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/FleetSessionsPanel.test.tsx
```

Expected: PASS with the default board view rendered and the instance navigation assertion green.

- [ ] **Step 5: Commit the board shell**

```bash
git add packages/web/vite.config.ts packages/web/src/test/setup.ts packages/web/src/components/instances/ActivityBoard.tsx packages/web/src/components/instances/FleetSessionsPanel.tsx packages/web/src/components/instances/FleetSessionsPanel.test.tsx
git commit -m "feat: add activity board view shell"
```

### Task 3: Finish board visuals, translations, and responsive styling

**Files:**
- Modify: `packages/web/src/i18n/locales/en.ts`
- Modify: `packages/web/src/i18n/locales/zh.ts`
- Modify: `packages/web/src/index.css`
- Modify: `packages/web/src/components/instances/ActivityBoard.tsx`
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`

- [ ] **Step 1: Write the failing UI assertions for labels and view switching**

```tsx
it('switches to table mode without losing the active filters', () => {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <FleetSessionsPanel />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Error' }));
  fireEvent.click(screen.getByRole('button', { name: 'Table' }));
  expect(screen.getByRole('columnheader', { name: 'Session' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Run the UI assertions to verify they fail**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/FleetSessionsPanel.test.tsx
```

Expected: FAIL because the new labels, toggle styling hooks, and view-preservation behavior are incomplete or untranslated.

- [ ] **Step 3: Implement translations and styling**

```ts
// packages/web/src/i18n/locales/en.ts
activityViewLabel: 'Activity view',
activityViewBoard: 'Board',
activityViewTable: 'Table',
activityBoardRunning: 'Running',
activityBoardDone: 'Done',
activityBoardFailed: 'Failed',
activityBoardKilledTimeout: 'Killed / Timeout',
activityBoardOther: 'Other',
activityBoardEmptyColumn: 'No sessions in this column.',
```

```ts
// packages/web/src/i18n/locales/zh.ts
activityViewLabel: '活动视图',
activityViewBoard: '看板',
activityViewTable: '表格',
activityBoardRunning: '运行中',
activityBoardDone: '已完成',
activityBoardFailed: '失败',
activityBoardKilledTimeout: '终止 / 超时',
activityBoardOther: '其他',
activityBoardEmptyColumn: '当前列没有会话。',
```

```css
/* packages/web/src/index.css */
.activity-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}

.activity-view-toggle {
  display: inline-flex;
  padding: 0.2rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.activity-view-button {
  border: 0;
  background: transparent;
  color: #94a5c6;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
}

.activity-view-button--active {
  color: #edf3ff;
  background: linear-gradient(135deg, rgba(63, 185, 255, 0.18), rgba(255, 177, 66, 0.14));
}

.activity-board-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(260px, 1fr);
  gap: 1rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.activity-column {
  min-height: 420px;
  border-radius: 20px;
  background: rgba(10, 16, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0.9rem;
}

.activity-card {
  border-radius: 18px;
  padding: 0.85rem;
  margin-top: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.activity-card-preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

@media (max-width: 720px) {
  .activity-board-grid {
    grid-auto-flow: row;
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run the component suite to verify it passes**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/activityViewModel.test.ts src/components/instances/FleetSessionsPanel.test.tsx
```

Expected: PASS with helper tests and UI tests both green.

- [ ] **Step 5: Commit the board polish**

```bash
git add packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts packages/web/src/index.css packages/web/src/components/instances/ActivityBoard.tsx packages/web/src/components/instances/FleetSessionsPanel.tsx packages/web/src/components/instances/FleetSessionsPanel.test.tsx
git commit -m "feat: polish activity board experience"
```

### Task 4: Add Playwright coverage for the Activity board

**Files:**
- Modify: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Write the failing Playwright scenarios**

```ts
test('activity page supports board and table views for admin sessions', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-1',
        mode: 'docker',
        status: 'running',
        port: 3101,
        token: 'masked-token',
        uptime: 3600,
        cpu: 14,
        memory: { used: 1024, limit: 2048 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
    ],
    sessions: [
      {
        instanceId: 'openclaw-1',
        sessions: [
          {
            key: 'run-1',
            derivedTitle: 'Running task',
            status: 'running',
            totalTokens: 1200,
            estimatedCostUsd: 1.25,
            lastMessagePreview: 'Working on activity board',
            updatedAt: Date.now(),
          },
          {
            key: 'done-1',
            derivedTitle: 'Completed task',
            status: 'done',
            totalTokens: 50,
            updatedAt: Date.now() - 60_000,
          },
        ],
      },
    ],
  });

  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Running task')).toBeVisible();
  await expect(page.getByText('Completed task')).toBeVisible();

  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Session' })).toBeVisible();
});
```

```ts
test('activity board shows per-instance session fetch errors', async ({ page }) => {
  await mountDashboard(page, {
    fleetMode: 'hybrid',
    instances: [
      {
        id: 'openclaw-2',
        mode: 'docker',
        status: 'running',
        port: 3121,
        token: 'masked-token',
        uptime: 3600,
        cpu: 2,
        memory: { used: 128, limit: 2048 },
        disk: { config: 100, workspace: 100 },
        health: 'healthy',
        image: 'openclaw:local',
      },
    ],
    sessions: [
      {
        instanceId: 'openclaw-2',
        sessions: [],
        error: 'connection refused',
      },
    ],
  });

  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByText('openclaw-2: connection refused')).toBeVisible();
});
```

- [ ] **Step 2: Run the Playwright scenarios to verify they fail**

Run:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test --config tests/playwright.config.ts --grep "activity"
```

Expected: FAIL because `mountDashboard` does not yet stub `/api/fleet/sessions`, and the Activity page does not yet render the board and toggle behavior the test expects.

- [ ] **Step 3: Extend the fixture and finish Activity assertions**

```ts
interface MountOptions {
  role?: Role;
  assignedProfiles?: string[];
  fleetMode: Mode;
  instances: FleetInstance[];
  sessions?: Array<{
    instanceId: string;
    sessions: Array<{
      key: string;
      derivedTitle?: string;
      status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
      totalTokens?: number;
      estimatedCostUsd?: number;
      lastMessagePreview?: string;
      updatedAt?: number;
    }>;
    error?: string;
  }>;
}

await page.route('**/api/fleet/sessions', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      instances: opts.sessions ?? [],
      updatedAt: Date.now(),
    }),
  });
});
```

```ts
await page.getByRole('button', { name: 'Activity' }).click();
await expect(page.getByText('Running')).toBeVisible();
await expect(page.getByText('Done')).toBeVisible();
await page.getByRole('button', { name: 'openclaw-1' }).click();
await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();
```

- [ ] **Step 4: Run the Playwright scenarios to verify they pass**

Run:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test --config tests/playwright.config.ts --grep "activity"
```

Expected: PASS with the Activity board and error-state scenarios green.

- [ ] **Step 5: Commit the Activity E2E coverage**

```bash
git add tests/e2e/ui-merge.spec.ts
git commit -m "test: cover activity board flows"
```

### Task 5: Final verification and cleanup

**Files:**
- Modify: `packages/web/src/components/instances/FleetSessionsPanel.tsx`
- Modify: `packages/web/src/components/instances/ActivityBoard.tsx`
- Modify: `packages/web/src/index.css`
- Modify: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Run the full targeted verification suite**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/activityViewModel.test.ts src/components/instances/FleetSessionsPanel.test.tsx
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test --config tests/playwright.config.ts --grep "activity|sidebar instance list scrolls"
```

Expected: PASS with all targeted Vitest and Playwright checks green.

- [ ] **Step 2: Re-run the verification suite after any targeted corrections**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- src/components/instances/activityViewModel.test.ts src/components/instances/FleetSessionsPanel.test.tsx
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 4173" PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npx playwright test --config tests/playwright.config.ts --grep "activity|sidebar instance list scrolls"
```

Expected: PASS again after any cleanup changes.

- [ ] **Step 3: Commit the verified implementation**

```bash
git add packages/web/src/components/instances/FleetSessionsPanel.tsx packages/web/src/components/instances/ActivityBoard.tsx packages/web/src/components/instances/activityViewModel.ts packages/web/src/components/instances/activityViewModel.test.ts packages/web/src/components/instances/FleetSessionsPanel.test.tsx packages/web/src/test/setup.ts packages/web/vite.config.ts packages/web/src/i18n/locales/en.ts packages/web/src/i18n/locales/zh.ts packages/web/src/index.css tests/e2e/ui-merge.spec.ts
git commit -m "feat: add activity task board"
```
