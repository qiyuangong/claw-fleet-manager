import { beforeEach, describe, expect, it } from 'vitest';
import { selectedInstanceIdSelector, useAppStore } from '../src/store';

beforeEach(() => {
  useAppStore.setState({
    activeView: { type: 'instances' },
    activeTab: 'overview',
    currentUser: null,
  });
});

describe('useAppStore — navigation', () => {
  it('starts on instances view', () => {
    expect(useAppStore.getState().activeView).toEqual({ type: 'instances' });
  });

  it('selectInstance sets activeView and resets tab to overview', () => {
    useAppStore.getState().setTab('logs');
    useAppStore.getState().selectInstance('openclaw-1');

    const { activeView, activeTab } = useAppStore.getState();

    expect(activeView).toEqual({ type: 'instance', id: 'openclaw-1' });
    expect(activeTab).toBe('overview');
  });

  it('selectInstances returns to instances view', () => {
    useAppStore.getState().selectInstance('openclaw-1');
    useAppStore.getState().selectInstances();
    expect(useAppStore.getState().activeView).toEqual({ type: 'instances' });
  });

  it('selectConfig sets config view', () => {
    useAppStore.getState().selectConfig();
    expect(useAppStore.getState().activeView).toEqual({ type: 'config' });
  });

  it('selectUsers sets users view', () => {
    useAppStore.getState().selectUsers();
    expect(useAppStore.getState().activeView).toEqual({ type: 'users' });
  });

  it('selectAccount sets account view', () => {
    useAppStore.getState().selectAccount();
    expect(useAppStore.getState().activeView).toEqual({ type: 'account' });
  });
});

describe('useAppStore — tabs', () => {
  it('setTab updates activeTab', () => {
    useAppStore.getState().setTab('logs');
    expect(useAppStore.getState().activeTab).toBe('logs');
  });

  it('setTab to metrics', () => {
    useAppStore.getState().setTab('metrics');
    expect(useAppStore.getState().activeTab).toBe('metrics');
  });
});

describe('useAppStore — currentUser', () => {
  it('setCurrentUser stores user', () => {
    const user = { username: 'alice', role: 'admin' as const, assignedProfiles: [] };
    useAppStore.getState().setCurrentUser(user);
    expect(useAppStore.getState().currentUser).toEqual(user);
  });

  it('setCurrentUser(null) clears user', () => {
    useAppStore.getState().setCurrentUser({ username: 'alice', role: 'admin', assignedProfiles: [] });
    useAppStore.getState().setCurrentUser(null);
    expect(useAppStore.getState().currentUser).toBeNull();
  });
});

describe('selectedInstanceIdSelector', () => {
  it('returns instance id when on instance view', () => {
    useAppStore.getState().selectInstance('openclaw-2');
    expect(selectedInstanceIdSelector(useAppStore.getState())).toBe('openclaw-2');
  });

  it('returns null when on instances view', () => {
    expect(selectedInstanceIdSelector(useAppStore.getState())).toBeNull();
  });

  it('returns null when on config view', () => {
    useAppStore.getState().selectConfig();
    expect(selectedInstanceIdSelector(useAppStore.getState())).toBeNull();
  });
});
