import { create } from 'zustand';
import type { PublicUser } from './types';

export type Tab = 'overview' | 'activity' | 'logs' | 'config' | 'metrics' | 'controlui' | 'feishu' | 'plugins';
export type ActiveView =
  | { type: 'instance'; id: string }
  | { type: 'instances' }
  | { type: 'config' }
  | { type: 'users' }
  | { type: 'account' }
  | { type: 'sessions' }
  | { type: 'runningSessions' }
  | { type: 'dashboard' };

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
}

export const useAppStore = create<AppState>((set) => ({
  activeView: { type: 'dashboard' },
  activeTab: 'overview',
  currentUser: null,
  selectInstance: (id, tab = 'overview') => set({ activeView: { type: 'instance', id }, activeTab: tab }),
  selectInstances: () => set({ activeView: { type: 'instances' } }),
  selectConfig: () => set({ activeView: { type: 'config' } }),
  selectUsers: () => set({ activeView: { type: 'users' } }),
  selectAccount: () => set({ activeView: { type: 'account' } }),
  selectSessions: () => set({ activeView: { type: 'sessions' } }),
  selectRunningSessions: () => set({ activeView: { type: 'runningSessions' } }),
  selectDashboard: () => set({ activeView: { type: 'dashboard' } }),
  setTab: (tab) => set({ activeTab: tab }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));

export const selectedInstanceIdSelector = (state: AppState) =>
  state.activeView.type === 'instance' ? state.activeView.id : null;
