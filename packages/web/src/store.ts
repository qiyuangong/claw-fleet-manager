import { create } from 'zustand';
import type { PublicUser } from './types';

type Tab = 'overview' | 'logs' | 'config' | 'metrics' | 'controlui' | 'feishu' | 'plugins';
type ActiveView = { type: 'instance'; id: string } | { type: 'config' } | { type: 'users' } | { type: 'account' };

interface AppState {
  activeView: ActiveView;
  activeTab: Tab;
  currentUser: PublicUser | null;
  selectInstance: (id: string) => void;
  selectConfig: () => void;
  selectUsers: () => void;
  selectAccount: () => void;
  setTab: (tab: Tab) => void;
  setCurrentUser: (user: PublicUser | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeView: { type: 'config' },
  activeTab: 'overview',
  currentUser: null,
  selectInstance: (id) => set({ activeView: { type: 'instance', id }, activeTab: 'overview' }),
  selectConfig: () => set({ activeView: { type: 'config' } }),
  selectUsers: () => set({ activeView: { type: 'users' } }),
  selectAccount: () => set({ activeView: { type: 'account' } }),
  setTab: (tab) => set({ activeTab: tab }),
  setCurrentUser: (user) => set({ currentUser: user }),
}));

export const selectedInstanceIdSelector = (state: AppState) =>
  state.activeView.type === 'instance' ? state.activeView.id : null;
