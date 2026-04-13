import { create } from 'zustand';
import type { NavigationState } from './navigation';
import type { PublicUser } from './types';

export const NAVIGATION_TABS = ['overview', 'activity', 'logs', 'config', 'metrics', 'controlui', 'feishu', 'plugins'] as const;
export const TOP_LEVEL_VIEWS = ['instances', 'config', 'users', 'account', 'sessions', 'runningSessions', 'dashboard'] as const;

export type Tab = (typeof NAVIGATION_TABS)[number];
export type ActiveView = { type: 'instance'; id: string } | { type: (typeof TOP_LEVEL_VIEWS)[number] };

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
  selectRunningSessions: () => void;
  selectDashboard: () => void;
  setTab: (tab: Tab) => void;
  setCurrentUser: (user: PublicUser | null) => void;
  applyNavigationState: (navigationState: NavigationState) => void;
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
  selectRunningSessions: () => set({ activeView: { type: 'runningSessions' }, activeTab: 'overview' }),
  selectDashboard: () => set({ activeView: { type: 'dashboard' }, activeTab: 'overview' }),
  setTab: (tab) => set({ activeTab: tab }),
  setCurrentUser: (user) => set({ currentUser: user }),
  applyNavigationState: (navigationState) => set({
    activeView: navigationState.activeView,
    activeTab: navigationState.activeView.type === 'instance' ? navigationState.activeTab : 'overview',
  }),
}));

export const selectedInstanceIdSelector = (state: AppState) =>
  state.activeView.type === 'instance' ? state.activeView.id : null;
