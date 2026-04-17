import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetSessionsPanel } from './FleetSessionsPanel';
import { useAppStore } from '../../store';

const mockUseFleetSessionsHistory = vi.fn();
const translations: Record<string, string> = {
  activityViewBoard: 'Board view',
  activityViewTable: 'Table view',
  activityBoardRunning: 'Running now',
  activityBoardDone: 'Completed',
  activityBoardFailed: 'Failed',
  activityBoardKilledTimeout: 'Killed / timed out',
  activityBoardOther: 'Other',
  activityBoardEmpty: 'No sessions',
  colInstance: 'Instance',
  activitySearchLabel: 'Search sessions',
  activitySearchPlaceholder: 'Search sessions',
  statusFilterAll: 'All',
  statusFilterActive: 'Active',
  statusFilterDone: 'Done',
  statusFilterError: 'Error',
  timeFilterToday: 'Today',
  timeFilter24h: '24h',
  timeFilter7d: '7d',
  timeFilterAll: 'All time',
  sessionHistoryDisabled: 'Session history is disabled in server config.',
};

vi.mock('../../hooks/useFleetSessionsHistory', () => ({
  useFleetSessionsHistory: (options: unknown) => mockUseFleetSessionsHistory(options),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FleetSessionsPanel />
    </QueryClientProvider>,
  );
}

describe('FleetSessionsPanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: { type: 'sessions' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });
    window.history.replaceState({}, '', '/?view=sessions');

    mockUseFleetSessionsHistory.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: [
              {
                key: 'run-1',
                derivedTitle: 'Running task',
                status: 'running',
                updatedAt: Date.now() - 5_000,
              },
            ],
          },
          {
            instanceId: 'beta',
            error: 'Unreachable',
            sessions: [],
          },
          {
            instanceId: 'gamma',
            sessions: [
              {
                key: 'done-1',
                derivedTitle: 'Finished task',
                status: 'done',
                updatedAt: Date.now() - 10_000,
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      historyDisabled: false,
    });
  });

  it('hydrates URL-backed filters and queries the history endpoint', () => {
    window.history.replaceState({}, '', '/?view=sessions&status=done&time=7d&q=alpha');

    renderPanel();

    expect((screen.getByRole('searchbox', { name: 'Search sessions' }) as HTMLInputElement).value).toBe('alpha');
    expect(mockUseFleetSessionsHistory).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        status: 'done',
        q: 'alpha',
        from: expect.any(Number),
        limit: 1000,
      }),
    }));
  });

  it('defaults to board mode and renders grouped board content', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Running now' })).not.toBeNull();
    expect(screen.getByText('Running task')).not.toBeNull();
    expect(screen.getByText('beta: Unreachable')).not.toBeNull();
  });

  it('switches to table mode and preserves the existing table view', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Table view' }));

    expect(screen.getByRole('button', { name: 'Table view' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Instance' })).not.toBeNull();
  });

  it('renders per-instance errors when every instance fetch fails with zero sessions', async () => {
    const user = userEvent.setup();

    mockUseFleetSessionsHistory.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            error: 'Unreachable',
            sessions: [],
          },
          {
            instanceId: 'beta',
            error: 'Timed out',
            sessions: [],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      historyDisabled: false,
    });

    renderPanel();

    expect(screen.getByText('alpha: Unreachable')).not.toBeNull();
    expect(screen.getByText('beta: Timed out')).not.toBeNull();
    expect(screen.queryByText('noActiveSessions')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Table view' }));

    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.getByText('⚠ alpha: Unreachable')).not.toBeNull();
    expect(screen.getByText('⚠ beta: Timed out')).not.toBeNull();
    expect(screen.queryByText('noActiveSessions')).toBeNull();
  });

  it('renders sortable table headers as buttons with exposed sort state', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Table view' }));

    const tokensHeader = screen.getByRole('columnheader', { name: /colTokens/i });
    const tokensSortButton = screen.getByRole('button', { name: /colTokens/i });

    expect(tokensHeader.getAttribute('aria-sort')).toBe('none');

    await user.click(tokensSortButton);

    expect(tokensHeader.getAttribute('aria-sort')).toBe('descending');
    expect(tokensSortButton).not.toBeNull();
  });

  it('selects an instance when a board card is clicked', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'alpha Running task run-1' }));

    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'alpha' });
  });

  it('disambiguates board card labels when one instance has multiple sessions', async () => {
    const user = userEvent.setup();

    mockUseFleetSessionsHistory.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: [
              {
                key: 'run-1',
                derivedTitle: 'Running task',
                status: 'running',
                updatedAt: Date.now() - 5_000,
              },
              {
                key: 'run-2',
                derivedTitle: 'Follow-up task',
                status: 'running',
                updatedAt: Date.now() - 4_000,
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      historyDisabled: false,
    });

    renderPanel();

    expect(screen.getByRole('button', { name: 'alpha Running task run-1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'alpha Follow-up task run-2' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'alpha Follow-up task run-2' }));

    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'alpha' });
  });

  it('uses stable unique labels when the same instance has duplicate session titles', async () => {
    const user = userEvent.setup();

    mockUseFleetSessionsHistory.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: [
              {
                key: 'run-1',
                derivedTitle: 'Repeated task',
                status: 'running',
                updatedAt: Date.now() - 5_000,
              },
              {
                key: 'run-2',
                derivedTitle: 'Repeated task',
                status: 'running',
                updatedAt: Date.now() - 4_000,
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      historyDisabled: false,
    });

    renderPanel();

    expect(screen.getByRole('button', { name: 'alpha Repeated task run-1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'alpha Repeated task run-2' })).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'alpha Repeated task run-2' }));

    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'alpha' });
  });

  it('updates the URL when a filter chip is clicked', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Active' }));

    expect(window.location.search).toContain('status=active');
  });

  it('renders the disabled-history notice', () => {
    mockUseFleetSessionsHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      historyDisabled: true,
    });

    renderPanel();

    expect(screen.queryByText('Session history is disabled in server config.')).not.toBeNull();
  });
});
