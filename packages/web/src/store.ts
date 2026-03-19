import { create } from 'zustand';

type Tab = 'overview' | 'logs' | 'config' | 'metrics' | 'controlui';

interface AppState {
  selectedInstanceId: string | null;
  activeTab: Tab;
  selectInstance: (id: string | null) => void;
  setTab: (tab: Tab) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedInstanceId: null,
  activeTab: 'overview',
  selectInstance: (id) => set({ selectedInstanceId: id, activeTab: 'overview' }),
  setTab: (tab) => set({ activeTab: tab }),
}));
