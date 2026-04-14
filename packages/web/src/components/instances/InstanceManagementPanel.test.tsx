import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceManagementPanel } from './InstanceManagementPanel';
import { useAppStore } from '../../store';

const useFleetMock = vi.fn();

vi.mock('../../hooks/useFleet', () => ({
  useFleet: () => useFleetMock(),
}));

vi.mock('../../api/fleet', () => ({
  deleteInstance: vi.fn(),
  startInstance: vi.fn(),
  stopInstance: vi.fn(),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InstanceManagementPanel onOpenInstance={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('InstanceManagementPanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: { type: 'instances' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });

    useFleetMock.mockReturnValue({
      data: {
        instances: [
          {
            id: 'openclaw-1',
            runtime: 'openclaw',
            mode: 'docker',
            runtimeCapabilities: {
              configEditor: true,
              logs: true,
              rename: true,
              delete: true,
              proxyAccess: true,
              sessions: true,
              plugins: true,
              runtimeAdmin: true,
            },
            index: 1,
            status: 'running',
            port: 18789,
            token: 'masked',
            uptime: 100,
            cpu: 1,
            memory: { used: 1, limit: 2 },
            disk: { config: 1, workspace: 2 },
            health: 'healthy',
            image: 'openclaw:local',
          },
        ],
      },
      isLoading: false,
    });
  });

  it('does not offer Hermes profile creation in the add-instance menu', async () => {
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: 'addInstance' }));

    expect(screen.getByRole('button', { name: 'createOpenClawDockerInstance' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'createOpenClawProfileInstance' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'createHermesDockerInstance' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'createHermesProfileInstance' })).toBeNull();
  });
});
