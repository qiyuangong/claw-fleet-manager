import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/components/layout/Shell';
import { useAppStore } from '../src/store';

const mockUseCurrentUser = vi.fn();
const mockUseFleet = vi.fn();
let currentUserResult: { data: unknown; error: Error | null; isLoading: boolean };
let fleetResult: { data: unknown; error: Error | null; isLoading: boolean };

vi.mock('../src/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock('../src/hooks/useFleet', () => ({
  useFleet: () => mockUseFleet(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../src/components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('../src/components/config/FleetConfigPanel', () => ({
  FleetConfigPanel: () => <section>config panel</section>,
}));

vi.mock('../src/components/instances/FleetDashboardPanel', () => ({
  FleetDashboardPanel: () => <section>dashboard panel</section>,
}));

vi.mock('../src/components/instances/InstancePanel', () => ({
  InstancePanel: ({ instanceId }: { instanceId: string }) => <section>instance {instanceId}</section>,
}));

vi.mock('../src/components/instances/InstanceManagementPanel', () => ({
  InstanceManagementPanel: () => <section>instances panel</section>,
}));

vi.mock('../src/components/instances/FleetSessionsPanel', () => ({
  FleetSessionsPanel: () => <section>sessions panel</section>,
}));

vi.mock('../src/components/users/UserHomePanel', () => ({
  UserHomePanel: () => <section>account panel</section>,
}));

vi.mock('../src/components/users/UserManagementPanel', () => ({
  UserManagementPanel: () => <section>users panel</section>,
}));

vi.mock('../src/components/users/ChangePasswordDialog', () => ({
  ChangePasswordDialog: () => null,
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

describe('Shell navigation history sync', () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReset();
    mockUseFleet.mockReset();

    currentUserResult = {
      data: { username: 'admin', role: 'admin', assignedProfiles: [] },
      error: null,
      isLoading: false,
    };
    fleetResult = {
      data: { instances: [], totalRunning: 0 },
      error: null,
      isLoading: false,
    };
    mockUseCurrentUser.mockImplementation(() => currentUserResult);
    mockUseFleet.mockImplementation(() => fleetResult);

    window.history.replaceState({}, '', '/');
    useAppStore.setState({
      activeView: { type: 'instances' },
      activeTab: 'overview',
      currentUser: null,
    });
  });

  it('hydrates the store from the current URL and normalizes history with replaceState on first load', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    window.history.replaceState({}, '', '/?view=instance&id=openclaw-1&tab=logs');

    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-1' });
    });

    expect(useAppStore.getState().activeTab).toBe('logs');
    expect(window.location.search).toBe('?view=instance&id=openclaw-1&tab=logs');
    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/?view=instance&id=openclaw-1&tab=logs');
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('re-hydrates from the URL after logout and login while Shell stays mounted', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

    const view = renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'dashboard' });
    });

    act(() => {
      currentUserResult = {
        data: null,
        error: new Error('signed out'),
        isLoading: false,
      };
      view.rerender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Shell />
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(useAppStore.getState().currentUser).toBeNull();
    });

    pushStateSpy.mockClear();
    replaceStateSpy.mockClear();

    act(() => {
      window.history.replaceState({}, '', '/?view=users');
      currentUserResult = {
        data: { username: 'member', role: 'user', assignedProfiles: [] },
        error: null,
        isLoading: false,
      };
      view.rerender(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Shell />
        </QueryClientProvider>,
      );
    });

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'account' });
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?view=account');
    });

    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/?view=account');
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('applies browser back and forward navigation without pushing a duplicate entry', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'dashboard' });
    });

    pushStateSpy.mockClear();
    act(() => {
      window.history.replaceState({}, '', '/?view=instance&id=openclaw-2&tab=metrics');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-2' });
    });

    expect(useAppStore.getState().activeTab).toBe('metrics');
    expect(pushStateSpy).not.toHaveBeenCalled();

    act(() => {
      useAppStore.getState().selectUsers();
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?view=users');
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/?view=users');
  });

  it('pushes history for new navigation state and skips duplicate URLs', async () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'dashboard' });
    });

    pushStateSpy.mockClear();

    act(() => {
      useAppStore.getState().selectUsers();
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?view=users');
    });

    expect(pushStateSpy).toHaveBeenCalledWith({}, '', '/?view=users');

    pushStateSpy.mockClear();
    act(() => {
      useAppStore.getState().applyNavigationState({
        activeView: { type: 'users' },
        activeTab: 'overview',
      });
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?view=users');
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('normalizes unauthorized popstate routes to the role-guarded destination URL', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    mockUseCurrentUser.mockReturnValue({
      data: { username: 'member', role: 'user', assignedProfiles: [] },
      error: null,
      isLoading: false,
    });
    mockUseFleet.mockReturnValue({
      data: { instances: [], totalRunning: 0 },
      error: null,
      isLoading: false,
    });

    renderShell();

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'account' });
    });

    replaceStateSpy.mockClear();
    pushStateSpy.mockClear();

    act(() => {
      window.history.replaceState({}, '', '/?view=users');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(useAppStore.getState().activeView).toEqual({ type: 'account' });
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?view=account');
    });

    expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/?view=account');
    expect(pushStateSpy).not.toHaveBeenCalled();
  });
});
