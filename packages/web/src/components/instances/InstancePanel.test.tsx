import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstancePanel } from './InstancePanel';
import { useAppStore } from '../../store';

const useFleetMock = vi.fn();

vi.mock('../../hooks/useFleet', () => ({
  useFleet: () => useFleetMock(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('InstancePanel', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: { type: 'instance', id: 'research-bot' },
      activeTab: 'overview',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });

    useFleetMock.mockReturnValue({
      data: {
        instances: [
          {
            id: 'research-bot',
            runtime: 'hermes',
            mode: 'profile',
            runtimeCapabilities: {
              configEditor: true,
              logs: true,
              rename: true,
              delete: true,
              proxyAccess: false,
              sessions: false,
              plugins: false,
              runtimeAdmin: true,
            },
            status: 'running',
            port: 18789,
            token: 'abc1***f456',
            uptime: 3600,
            cpu: 12.3,
            memory: { used: 1024, limit: 2048 },
            disk: { config: 1000, workspace: 2000 },
            health: 'healthy',
            image: 'ghcr.io/acme/hermes:latest',
            profile: 'research-bot',
            pid: 4242,
          },
        ],
      },
    });
  });

  it('hides OpenClaw-only tabs for Hermes instances without those capabilities', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <InstancePanel instanceId="research-bot" />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: 'tabOverview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tabLogs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tabConfig' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tabActivity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tabControlUi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'tabPlugins' })).not.toBeInTheDocument();
  });

  it('resets a stale unsupported tab back to overview for Hermes instances', async () => {
    useAppStore.setState({
      activeView: { type: 'instance', id: 'research-bot' },
      activeTab: 'controlui',
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <InstancePanel instanceId="research-bot" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(useAppStore.getState().activeTab).toBe('overview');
    });
    expect(screen.queryByRole('button', { name: 'tabControlUi' })).not.toBeInTheDocument();
  });
});
