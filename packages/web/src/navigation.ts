import type { ActiveView, Tab } from './store';

export type NavigationState = {
  activeView: ActiveView;
  activeTab: Tab;
};

const validTabs: Tab[] = ['overview', 'activity', 'logs', 'config', 'metrics', 'controlui', 'feishu', 'plugins'];
const topLevelViews: ActiveView['type'][] = ['instances', 'config', 'users', 'account', 'sessions', 'dashboard'];

function isTab(value: string | null): value is Tab {
  return value !== null && validTabs.includes(value as Tab);
}

function isTopLevelView(value: string | null): value is ActiveView['type'] {
  return value !== null && topLevelViews.includes(value as ActiveView['type']);
}

function parseInstanceState(url: URL, fallback: NavigationState): NavigationState {
  const id = url.searchParams.get('id');
  if (!id) return fallback;

  const tab = url.searchParams.get('tab');

  return {
    activeView: { type: 'instance', id },
    activeTab: isTab(tab) ? tab : 'overview',
  };
}

export function defaultNavigationState(isAdmin: boolean): NavigationState {
  return {
    activeView: isAdmin ? { type: 'dashboard' } : { type: 'account' },
    activeTab: 'overview',
  };
}

export function parseNavigationFromUrl(url: string, fallback: NavigationState): NavigationState {
  const parsed = new URL(url, 'https://example.test');
  const view = parsed.searchParams.get('view');

  if (view === 'instance') {
    return parseInstanceState(parsed, fallback);
  }

  if (isTopLevelView(view)) {
    return {
      activeView: { type: view },
      activeTab: 'overview',
    };
  }

  return fallback;
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

  const query = params.toString();
  return query ? `/?${query}` : '/';
}
