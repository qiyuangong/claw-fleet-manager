import { NAVIGATION_TABS, TOP_LEVEL_VIEWS, type ActiveView, type Tab } from './store';

export type NavigationState = {
  activeView: ActiveView;
  activeTab: Tab;
};

function isTab(value: string | null): value is Tab {
  return value !== null && NAVIGATION_TABS.includes(value as Tab);
}

function isTopLevelView(value: string | null): value is ActiveView['type'] {
  return value !== null && TOP_LEVEL_VIEWS.includes(value as ActiveView['type']);
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

export function parseNavigationFromUrl(url: URL, fallback: NavigationState): NavigationState {
  const view = url.searchParams.get('view');

  if (view === 'instance') {
    return parseInstanceState(url, fallback);
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
