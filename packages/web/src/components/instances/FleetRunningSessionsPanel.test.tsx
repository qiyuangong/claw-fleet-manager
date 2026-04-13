import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetRunningSessionsPanel } from './FleetRunningSessionsPanel';
import { useAppStore } from '../../store';

const mockUseFleetSessions = vi.fn();
const translations: Record<string, string> = {
  runningSessionsTitle: 'Running sessions',
  runningSessionsDesc: 'Live running work only, shown as searchable cards with compact paging.',
  runningSessionsEmpty: 'No running sessions right now.',
  runningSessionsNoSearchResults: 'No running sessions match the current search.',
  runningSessionsMonitorStarted: 'Live polling on',
  runningSessionsMonitorStopped: 'Live polling off',
  runningSessionsStoppedHelp: 'Live polling is stopped. Press Start to begin updating the running session boxes.',
  runningSessionsRoleUser: 'User',
  runningSessionsRoleAssistant: 'Agent',
  runningSessionsRoleTool: 'Tool',
  runningSessionsPrevious: 'Previous',
  runningSessionsNext: 'Next',
  runningSessionsPagerLabel: 'Running sessions pages',
  runningSessionOpen: 'Open instance',
  activitySearchLabel: 'Search activity sessions',
  activitySearchPlaceholder: 'Search instance, session, model, or preview',
  sessionRunning: 'running',
  start: 'Start',
  stop: 'Stop',
  refresh: 'Refresh',
  clear: 'Clear',
  tokens: 'Tokens',
  cost: 'Cost',
  colUpdated: 'Updated',
};

vi.mock('../../hooks/useFleetSessions', () => ({
  useFleetSessions: (...args: unknown[]) => mockUseFleetSessions(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === 'runningSessionsPage' && params?.page != null) return `Page ${params.page}`;
      if (key === 'runningSessionsPageSummary' && params) return `${params.shown} of ${params.total} running sessions`;
      return translations[key] ?? key;
    },
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
      <FleetRunningSessionsPanel />
    </QueryClientProvider>,
  );
}

function buildRunningSession(index: number) {
  return {
    key: `run-${index}`,
    derivedTitle: `Running task ${index}`,
    status: 'running' as const,
    updatedAt: Date.now() - index * 1_000,
    model: index % 2 === 0 ? 'gpt-5.4' : 'claude-opus',
    lastMessagePreview: `Preview ${index}`,
    previewItems: [
      { role: 'user', text: `Question ${index}` },
      { role: 'assistant', text: `Answer ${index}` },
    ],
  };
}

describe('FleetRunningSessionsPanel', () => {
  beforeEach(() => {
    mockUseFleetSessions.mockClear();
    window.localStorage.clear();
    useAppStore.setState({
      activeView: { type: 'runningSessions' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });

    mockUseFleetSessions.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: [
              buildRunningSession(1),
              { key: 'done-1', derivedTitle: 'Done task', status: 'done', updatedAt: Date.now() - 100_000 },
            ],
          },
          {
            instanceId: 'beta',
            sessions: [buildRunningSession(2)],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
  });

  it('stays stopped by default and enables live polling only after start', async () => {
    const user = userEvent.setup();

    renderPanel();

    expect(screen.getByRole('heading', { name: 'Running sessions' })).not.toBeNull();
    expect(screen.getByText('Live polling off')).not.toBeNull();
    expect(screen.getByText('Live polling is stopped. Press Start to begin updating the running session boxes.')).not.toBeNull();
    expect(mockUseFleetSessions).toHaveBeenLastCalledWith({
      enabled: false,
      refetchIntervalMs: 300,
      status: 'running',
      previewLimit: 4,
    });

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByText('Live polling on')).not.toBeNull();
    expect(mockUseFleetSessions).toHaveBeenLastCalledWith({
      enabled: true,
      refetchIntervalMs: 300,
      status: 'running',
      previewLimit: 4,
    });
  });

  it('remembers the monitoring state across remounts', async () => {
    const user = userEvent.setup();

    const firstRender = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(window.localStorage.getItem('fleet_running_sessions_monitoring_state')).toBe('started');

    firstRender.unmount();
    renderPanel();

    expect(screen.getByText('Live polling on')).not.toBeNull();
    expect(mockUseFleetSessions).toHaveBeenLastCalledWith({
      enabled: true,
      refetchIntervalMs: 300,
      status: 'running',
      previewLimit: 4,
    });
  });

  it('shows only running sessions as cards after start', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByRole('button', { name: 'alpha Running task 1 run-1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'beta Running task 2 run-2' })).not.toBeNull();
    expect(screen.queryByText('Done task')).toBeNull();
    expect(screen.getByText('Question 1')).not.toBeNull();
    expect(screen.getByText('Answer 1')).not.toBeNull();
  });

  it('filters cards in real time from the search input', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search activity sessions' }), 'beta');

    expect(screen.queryByRole('button', { name: 'alpha Running task 1 run-1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'beta Running task 2 run-2' })).not.toBeNull();
  });

  it('paginates cards in groups of nine', async () => {
    const user = userEvent.setup();

    mockUseFleetSessions.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: Array.from({ length: 12 }, (_, index) => buildRunningSession(index + 1)),
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByRole('button', { name: 'alpha Running task 1 run-1' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'alpha Running task 9 run-9' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'alpha Running task 10 run-10' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Page 2' }));

    expect(screen.getByRole('button', { name: 'alpha Running task 10 run-10' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'alpha Running task 1 run-1' })).toBeNull();
  });

  it('opens the instance activity tab from a running session card', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await user.click(screen.getByRole('button', { name: 'alpha Running task 1 run-1' }));

    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'alpha' });
    expect(useAppStore.getState().activeTab).toBe('activity');
  });
});
