# Browser History Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser back/forward restore the manager's top-level page and per-instance tab by synchronizing the existing Zustand navigation state with the browser URL and history stack.

**Architecture:** Keep Zustand as the app-facing navigation API, add a small navigation codec that converts between URL query params and app navigation state, and let `Shell` own initial hydration plus `popstate` handling. User-driven store transitions should produce normalized URLs, while history-driven transitions should restore store state without pushing duplicate entries.

**Tech Stack:** React 19, TypeScript, Zustand, React Query, Vitest, Testing Library, Playwright

---

## File Structure

- Create: `packages/web/src/navigation.ts`
  - Pure helpers to parse/serialize `view`, `id`, and `tab`.
- Modify: `packages/web/src/store.ts`
  - Export navigation types and add an internal state-application action for URL hydration.
- Modify: `packages/web/src/components/layout/Shell.tsx`
  - Hydrate from URL, listen for `popstate`, and keep browser history synchronized with store changes.
- Create: `packages/web/tests/navigation.test.ts`
  - Pure tests for URL parsing and serialization.
- Modify: `packages/web/tests/store.test.ts`
  - Cover the new store-level navigation application behavior.
- Create: `packages/web/tests/Shell.navigation.test.tsx`
  - Verify initial URL hydration and browser back/forward behavior without Playwright overhead.
- Modify: `tests/e2e/ui-merge.spec.ts`
  - Add a regression test that proves browser back/forward restores views and instance tabs in the real UI.

### Task 1: Add a pure navigation codec

**Files:**
- Create: `packages/web/src/navigation.ts`
- Create: `packages/web/tests/navigation.test.ts`
- Modify: `packages/web/src/store.ts`

- [ ] **Step 1: Write the failing codec tests**

Create `packages/web/tests/navigation.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  defaultNavigationState,
  parseNavigationFromUrl,
  serializeNavigationToUrl,
} from '../src/navigation';

describe('navigation codec', () => {
  it('parses an instance URL with a tab', () => {
    const state = parseNavigationFromUrl(
      new URL('http://localhost/?view=instance&id=openclaw-1&tab=logs'),
      defaultNavigationState(true),
    );

    expect(state).toEqual({
      activeView: { type: 'instance', id: 'openclaw-1' },
      activeTab: 'logs',
    });
  });

  it('falls back invalid views to the provided default', () => {
    const state = parseNavigationFromUrl(
      new URL('http://localhost/?view=nope'),
      defaultNavigationState(false),
    );

    expect(state).toEqual({
      activeView: { type: 'account' },
      activeTab: 'overview',
    });
  });

  it('falls back invalid instance tabs to overview', () => {
    const state = parseNavigationFromUrl(
      new URL('http://localhost/?view=instance&id=openclaw-7&tab=bogus'),
      defaultNavigationState(true),
    );

    expect(state).toEqual({
      activeView: { type: 'instance', id: 'openclaw-7' },
      activeTab: 'overview',
    });
  });

  it('serializes overview instance URLs without a tab query param', () => {
    expect(serializeNavigationToUrl({
      activeView: { type: 'instance', id: 'openclaw-1' },
      activeTab: 'overview',
    })).toBe('/?view=instance&id=openclaw-1');
  });

  it('serializes top-level views to a stable query string', () => {
    expect(serializeNavigationToUrl({
      activeView: { type: 'sessions' },
      activeTab: 'overview',
    })).toBe('/?view=sessions');
  });
});
```

- [ ] **Step 2: Run the codec tests to verify red**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- tests/navigation.test.ts
```

Expected: FAIL with `Cannot find module '../src/navigation'` and missing exported helpers.

- [ ] **Step 3: Export navigation types from the store**

In `packages/web/src/store.ts`, change the top type declarations so the codec can import them:

```ts
import { create } from 'zustand';
import type { PublicUser } from './types';

export type Tab =
  | 'overview'
  | 'activity'
  | 'logs'
  | 'config'
  | 'metrics'
  | 'controlui'
  | 'feishu'
  | 'plugins';

export type ActiveView =
  | { type: 'instance'; id: string }
  | { type: 'instances' }
  | { type: 'config' }
  | { type: 'users' }
  | { type: 'account' }
  | { type: 'sessions' }
  | { type: 'dashboard' };
```

- [ ] **Step 4: Add the codec implementation**

Create `packages/web/src/navigation.ts` with:

```ts
import type { ActiveView, Tab } from './store';

export type NavigationState = {
  activeView: ActiveView;
  activeTab: Tab;
};

const validViews = new Set<ActiveView['type']>([
  'instance',
  'instances',
  'config',
  'users',
  'account',
  'sessions',
  'dashboard',
]);

const validTabs = new Set<Tab>([
  'overview',
  'activity',
  'logs',
  'config',
  'metrics',
  'controlui',
  'feishu',
  'plugins',
]);

export function defaultNavigationState(isAdmin: boolean): NavigationState {
  return {
    activeView: isAdmin ? { type: 'dashboard' } : { type: 'account' },
    activeTab: 'overview',
  };
}

export function parseNavigationFromUrl(url: URL, fallback: NavigationState): NavigationState {
  const rawView = url.searchParams.get('view');
  if (!rawView || !validViews.has(rawView as ActiveView['type'])) {
    return fallback;
  }

  if (rawView === 'instance') {
    const id = url.searchParams.get('id');
    const rawTab = url.searchParams.get('tab');
    const tab = rawTab && validTabs.has(rawTab as Tab) ? rawTab as Tab : 'overview';

    if (!id) {
      return fallback;
    }

    return {
      activeView: { type: 'instance', id },
      activeTab: tab,
    };
  }

  return {
    activeView: { type: rawView },
    activeTab: 'overview',
  };
}

export function serializeNavigationToUrl(state: NavigationState): string {
  const params = new URLSearchParams();
  params.set('view', state.activeView.type);

  if (state.activeView.type === 'instance') {
    params.set('id', state.activeView.id);
    if (state.activeTab !== 'overview') {
      params.set('tab', state.activeTab);
    }
  }

  return `/?${params.toString()}`;
}
```

- [ ] **Step 5: Run the codec tests to verify green**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- tests/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/store.ts \
  packages/web/src/navigation.ts \
  packages/web/tests/navigation.test.ts
git commit -m "feat: add web navigation codec"
```

---

### Task 2: Hydrate the store from URL and sync browser history

**Files:**
- Modify: `packages/web/src/store.ts`
- Modify: `packages/web/src/components/layout/Shell.tsx`
- Modify: `packages/web/tests/store.test.ts`
- Create: `packages/web/tests/Shell.navigation.test.tsx`

- [ ] **Step 1: Write the failing store and shell navigation tests**

Append this block to `packages/web/tests/store.test.ts`:

```ts
describe('useAppStore — applyNavigationState', () => {
  it('sets instance navigation state from URL hydration', () => {
    useAppStore.getState().applyNavigationState({
      activeView: { type: 'instance', id: 'openclaw-3' },
      activeTab: 'metrics',
    });

    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-3' });
    expect(useAppStore.getState().activeTab).toBe('metrics');
  });

  it('forces non-instance views back to overview tab', () => {
    useAppStore.getState().applyNavigationState({
      activeView: { type: 'users' },
      activeTab: 'logs',
    });

    expect(useAppStore.getState().activeView).toEqual({ type: 'users' });
    expect(useAppStore.getState().activeTab).toBe('overview');
  });
});
```

Create `packages/web/tests/Shell.navigation.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/components/layout/Shell';
import { useAppStore } from '../src/store';

const mockUseCurrentUser = vi.fn();
const mockUseFleet = vi.fn();

vi.mock('../src/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock('../src/hooks/useFleet', () => ({
  useFleet: () => mockUseFleet(),
}));

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>,
  );
}

describe('Shell navigation', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: { type: 'dashboard' },
      activeTab: 'overview',
      currentUser: null,
    });

    mockUseCurrentUser.mockReturnValue({
      data: { username: 'admin', role: 'admin', assignedProfiles: [] },
      error: null,
      isLoading: false,
    });

    mockUseFleet.mockReturnValue({
      data: {
        instances: [
          {
            id: 'openclaw-1',
            mode: 'docker',
            status: 'running',
            port: 3101,
            token: 'masked',
            uptime: 3600,
            cpu: 10,
            memory: { used: 100, limit: 200 },
            disk: { config: 10, workspace: 20 },
            health: 'healthy',
            image: 'openclaw:local',
          },
        ],
        totalRunning: 1,
        updatedAt: Date.now(),
      },
    });
  });

  it('hydrates the instance tab from the current URL', async () => {
    window.history.replaceState(null, '', '/?view=instance&id=openclaw-1&tab=logs');

    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-1' });
      expect(useAppStore.getState().activeTab).toBe('logs');
    });

    expect(screen.getByRole('button', { name: 'logs' })).toHaveClass('active');
  });

  it('restores prior navigation on popstate without losing the tab', async () => {
    window.history.replaceState(null, '', '/?view=instances');
    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'instances' });
    });

    window.history.pushState(null, '', '/?view=instance&id=openclaw-1&tab=metrics');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-1' });
      expect(useAppStore.getState().activeTab).toBe('metrics');
    });
  });
});
```

- [ ] **Step 2: Run the new tests to verify red**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- tests/store.test.ts tests/Shell.navigation.test.tsx
```

Expected:
- `applyNavigationState is not a function` from the store tests
- shell navigation assertions fail because `Shell` does not parse the URL or listen for `popstate`

- [ ] **Step 3: Add a store-level navigation application action**

Update `packages/web/src/store.ts` so the store can accept URL-driven state safely:

```ts
import { create } from 'zustand';
import type { PublicUser } from './types';
import type { NavigationState } from './navigation';

interface AppState {
  activeView: ActiveView;
  activeTab: Tab;
  currentUser: PublicUser | null;
  selectInstance: (id: string, tab?: Tab) => void;
  selectInstances: () => void;
  selectConfig: () => void;
  selectUsers: () => void;
  selectAccount: () => void;
  selectSessions: () => void;
  selectDashboard: () => void;
  setTab: (tab: Tab) => void;
  setCurrentUser: (user: PublicUser | null) => void;
  applyNavigationState: (state: NavigationState) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: { type: 'dashboard' },
  activeTab: 'overview',
  currentUser: null,
  selectInstance: (id, tab = 'overview') => set({ activeView: { type: 'instance', id }, activeTab: tab }),
  selectInstances: () => set({ activeView: { type: 'instances' }, activeTab: 'overview' }),
  selectConfig: () => set({ activeView: { type: 'config' }, activeTab: 'overview' }),
  selectUsers: () => set({ activeView: { type: 'users' }, activeTab: 'overview' }),
  selectAccount: () => set({ activeView: { type: 'account' }, activeTab: 'overview' }),
  selectSessions: () => set({ activeView: { type: 'sessions' }, activeTab: 'overview' }),
  selectDashboard: () => set({ activeView: { type: 'dashboard' }, activeTab: 'overview' }),
  setTab: (tab) => set((state) => (
    state.activeView.type === 'instance'
      ? { activeTab: tab }
      : { activeTab: 'overview' }
  )),
  setCurrentUser: (user) => set({ currentUser: user }),
  applyNavigationState: ({ activeView, activeTab }) => set({
    activeView,
    activeTab: activeView.type === 'instance' ? activeTab : 'overview',
  }),
}));
```

- [ ] **Step 4: Hydrate from URL and keep history synchronized in `Shell`**

Update `packages/web/src/components/layout/Shell.tsx` with:

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  defaultNavigationState,
  parseNavigationFromUrl,
  serializeNavigationToUrl,
} from '../../navigation';

export function Shell() {
  const activeView = useAppStore((state) => state.activeView);
  const activeTab = useAppStore((state) => state.activeTab);
  const applyNavigationState = useAppStore((state) => state.applyNavigationState);
  const currentUser = useAppStore((state) => state.currentUser);
  const historyModeRef = useRef<'push' | 'replace'>('replace');
  const hydratedRef = useRef(false);
  const skipPushRef = useRef(false);

  useEffect(() => {
    const fallback = defaultNavigationState(false);
    applyNavigationState(parseNavigationFromUrl(new URL(window.location.href), fallback));
    hydratedRef.current = true;

    const onPopState = () => {
      skipPushRef.current = true;
      applyNavigationState(
        parseNavigationFromUrl(
          new URL(window.location.href),
          defaultNavigationState(currentUser?.role === 'admin'),
        ),
      );
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyNavigationState, currentUser?.role]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const nextUrl = serializeNavigationToUrl({ activeView, activeTab });
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl === currentUrl) {
      return;
    }

    if (skipPushRef.current) {
      skipPushRef.current = false;
      window.history.replaceState(null, '', nextUrl);
      return;
    }

    if (historyModeRef.current === 'replace') {
      window.history.replaceState(null, '', nextUrl);
      historyModeRef.current = 'push';
      return;
    }

    window.history.pushState(null, '', nextUrl);
  }, [activeView, activeTab]);
```

Keep the existing non-admin guard effect. After the guard calls `selectAccount()` or another allowed navigation action, the history-sync effect above will rewrite the URL to the corrected destination.

- [ ] **Step 5: Run the store and shell tests to verify green**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test -- tests/store.test.ts tests/Shell.navigation.test.tsx tests/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/store.ts \
  packages/web/src/components/layout/Shell.tsx \
  packages/web/tests/store.test.ts \
  packages/web/tests/Shell.navigation.test.tsx
git commit -m "feat: sync shell navigation with browser history"
```

---

### Task 3: Add a real browser regression for back/forward

**Files:**
- Modify: `tests/e2e/ui-merge.spec.ts`

- [ ] **Step 1: Write the failing Playwright regression**

Add this test to `tests/e2e/ui-merge.spec.ts` after the existing admin navigation coverage:

```ts
test('browser back and forward restore manager views and instance tabs', async ({ page }) => {
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
        memory: { used: 1024 * 1024 * 512, limit: 1024 * 1024 * 1024 },
        disk: { config: 100, workspace: 200 },
        health: 'healthy',
        image: 'openclaw:local',
      },
    ],
  });

  await page.getByRole('button', { name: 'Manage Instances' }).click();
  await expect(page).toHaveURL(/view=instances/);
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();

  await page.locator('.table-shell tr', { hasText: 'openclaw-1' }).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();

  await page.getByRole('button', { name: 'logs' }).click();
  await expect(page).toHaveURL(/view=instance&id=openclaw-1&tab=logs/);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Runtime' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/view=instances/);
  await expect(page.getByRole('heading', { name: 'Instance Management' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/view=instance&id=openclaw-1$/);
  await expect(page.getByRole('heading', { name: 'Instance Workspace' })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/view=instance&id=openclaw-1&tab=logs/);
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run the Playwright regression to verify red**

Run:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 3001" \
npx playwright test --config tests/playwright.config.ts --grep "browser back and forward restore manager views and instance tabs"
```

Expected: FAIL because the URL does not update on view/tab changes and `goBack()` stays on the same screen.

- [ ] **Step 3: Run the browser regression to verify green**

Run:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 3001" \
npx playwright test --config tests/playwright.config.ts --grep "browser back and forward restore manager views and instance tabs"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/ui-merge.spec.ts packages/web/src/components/layout/Shell.tsx
git commit -m "test: cover browser history navigation"
```

---

### Task 4: Run the focused verification sweep

**Files:**
- No new files

- [ ] **Step 1: Run the full web unit test suite**

Run:

```bash
npm --workspace @claw-fleet-manager/web run test
```

Expected: PASS.

- [ ] **Step 2: Run the web build**

Run:

```bash
npm --workspace @claw-fleet-manager/web run build
```

Expected: PASS.

- [ ] **Step 3: Re-run the targeted browser regression**

Run:

```bash
PLAYWRIGHT_SERVER_COMMAND="npm --workspace @claw-fleet-manager/web run dev -- --host 127.0.0.1 --port 3001" \
npx playwright test --config tests/playwright.config.ts --grep "browser back and forward restore manager views and instance tabs"
```

Expected: PASS.

- [ ] **Step 4: Commit the verification checkpoint**

```bash
git status --short
```

Expected: no output from `git status --short` beyond the changes already committed in Tasks 1-3.
