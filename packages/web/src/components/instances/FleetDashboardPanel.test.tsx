import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetDashboardPanel } from './FleetDashboardPanel';
import { useAppStore } from '../../store';

const mockUseFleet = vi.fn();
const mockUseFleetSessionsHistory = vi.fn();

const translations: Record<string, string> = {
  dashboard: 'Dashboard',
  dashboardDesc: 'Dashboard description',
  refresh: 'Refresh',
  activitySearchLabel: 'Search sessions',
  activitySearchPlaceholder: 'Search sessions',
  clear: 'Clear',
  statusFilterAll: 'All',
  statusFilterActive: 'Active',
  statusFilterDone: 'Done',
  statusFilterError: 'Error',
  timeFilterToday: 'Today',
  timeFilter24h: '24h',
  timeFilter7d: '7d',
  timeFilterAll: 'All time',
  activityResultsSummary: '{{shown}}/{{total}}',
  activityResetFilters: 'Reset filters',
  sessionHistoryDisabled: 'Session history is disabled in server config.',
  noActiveSessions: 'No active sessions',
};

vi.mock('../../hooks/useFleet', () => ({
  useFleet: () => mockUseFleet(),
}));

vi.mock('../../hooks/useFleetSessionsHistory', () => ({
  useFleetSessionsHistory: (options: unknown) => mockUseFleetSessionsHistory(options),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const template = translations[key] ?? key;
      if (!params) return template;
      return Object.entries(params).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        template,
      );
    },
  }),
}));

vi.mock('./Dashboard', () => ({
  Dashboard: ({
    statusFocus,
    trendWindow,
    onStatusFocusChange,
    onTrendWindowChange,
  }: {
    statusFocus: string;
    trendWindow: string;
    onStatusFocusChange: (value: string) => void;
    onTrendWindowChange: (value: string) => void;
  }) => (
    <div>
      <div data-testid="dashboard-status-focus">{statusFocus}</div>
      <div data-testid="dashboard-trend-window">{trendWindow}</div>
      <button type="button" onClick={() => onStatusFocusChange('done')}>focus done</button>
      <button type="button" onClick={() => onTrendWindowChange('7d')}>trend 7d</button>
    </div>
  ),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <FleetDashboardPanel />
    </QueryClientProvider>,
  );
}

describe('FleetDashboardPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T00:00:00.000Z'));
    window.history.replaceState({}, '', '/?view=dashboard&status=done&time=7d&q=alpha&focus=failed&trend=7d');
    useAppStore.setState({
      activeView: { type: 'dashboard' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });
    mockUseFleet.mockReturnValue({
      data: { instances: [], totalRunning: 0, updatedAt: Date.now() },
    });
    mockUseFleetSessionsHistory.mockReturnValue({
      data: { instances: [], updatedAt: Date.now(), totalEstimate: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      dataUpdatedAt: Date.now(),
      historyDisabled: false,
    });
  });

  it('hydrates filters from the URL and queries the history endpoint', () => {
    renderPanel();

    expect((screen.getByRole('searchbox', { name: 'Search sessions' }) as HTMLInputElement).value).toBe('alpha');
    expect(screen.getByTestId('dashboard-status-focus').textContent).toContain('failed');
    expect(screen.getByTestId('dashboard-trend-window').textContent).toContain('7d');
    expect(mockUseFleetSessionsHistory).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        status: 'done',
        q: 'alpha',
        from: new Date('2026-04-10T00:00:00.000Z').getTime(),
        limit: 1000,
      }),
    }));
  });

  it('updates URL-backed focus and trend filters in place', async () => {
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'focus done' }));
    fireEvent.click(screen.getByRole('button', { name: 'trend 7d' }));

    expect(window.location.search).toContain('focus=done');
    expect(window.location.search).toContain('trend=7d');
  });

  it('renders the disabled-history notice when the history endpoint is unavailable', () => {
    mockUseFleetSessionsHistory.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
      dataUpdatedAt: 0,
      historyDisabled: true,
    });

    renderPanel();

    expect(screen.queryByText('Session history is disabled in server config.')).not.toBeNull();
  });
});
