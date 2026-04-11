import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameInstanceDialog } from '../src/components/instances/RenameInstanceDialog';
import { useAppStore } from '../src/store';
import type { FleetInstance } from '../src/types';

const renameInstanceMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('../src/api/fleet', () => ({
  renameInstance: (...args: unknown[]) => renameInstanceMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

function renderDialog(instance: Pick<FleetInstance, 'id' | 'mode' | 'image'>, onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(invalidateQueriesMock);

  render(
    <QueryClientProvider client={queryClient}>
      <RenameInstanceDialog
        instance={{
          ...instance,
          id: instance.id,
          mode: instance.mode,
          status: 'stopped',
          port: 18789,
          token: 'abc1***f456',
          uptime: 0,
          cpu: 0,
          memory: { used: 0, limit: 0 },
          disk: { config: 0, workspace: 0 },
          health: 'healthy',
          image: instance.image ?? '',
        }}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );

  return { onClose };
}

describe('RenameInstanceDialog', () => {
  beforeEach(() => {
    renameInstanceMock.mockReset();
    invalidateQueriesMock.mockReset();
    toastSuccessMock.mockReset();
    useAppStore.setState({
      activeView: { type: 'instances' },
      activeTab: 'overview',
      currentUser: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits rename and updates active instance view when renamed', async () => {
    const instance = {
      id: 'openclaw-1',
      mode: 'docker' as const,
      image: 'openclaw:local',
    };
    renameInstanceMock.mockResolvedValue({ ...instance, id: 'team-renamed', status: 'stopped' });
    useAppStore.setState({
      activeView: { type: 'instance', id: 'openclaw-1' },
      activeTab: 'overview',
      currentUser: null,
    });
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderDialog(instance, onClose);

    const input = screen.getByPlaceholderText('instanceNamePlaceholder');
    await user.clear(input);
    await user.type(input, 'team-renamed');
    await user.click(screen.getByRole('button', { name: 'renameInstanceCta' }));

    await waitFor(() => {
    expect(renameInstanceMock).toHaveBeenCalledWith('openclaw-1', 'team-renamed');
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['fleet'] });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['users'] });
    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'team-renamed' });
    expect(onClose).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it('prevents submitting if name is unchanged or invalid', async () => {
    const instance = {
      id: 'openclaw-1',
      mode: 'docker' as const,
      image: 'openclaw:local',
    };
    const user = userEvent.setup();
    renderDialog(instance);

    const input = screen.getByPlaceholderText('instanceNamePlaceholder');
    await user.clear(input);
    await user.type(input, 'openclaw-1');
    await user.click(screen.getByRole('button', { name: 'renameInstanceCta' }));
    expect(renameInstanceMock).not.toHaveBeenCalled();
  });
});
