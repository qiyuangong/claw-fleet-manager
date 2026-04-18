import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MigrateDialog } from '../src/components/instances/MigrateDialog';
import { useAppStore } from '../src/store';

const migrateInstanceMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('../src/api/fleet', () => ({
  migrateInstance: (...args: unknown[]) => migrateInstanceMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(invalidateQueriesMock);

  const onClose = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <MigrateDialog
        instance={{
          id: 'openclaw-1',
          mode: 'docker',
          status: 'running',
          port: 18789,
          token: 'abc1***f456',
          uptime: 0,
          cpu: 0,
          memory: { used: 0, limit: 0 },
          disk: { config: 0, workspace: 0 },
          health: 'healthy',
          image: 'openclaw:local',
        }}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );

  return { onClose };
}

describe('MigrateDialog', () => {
  beforeEach(() => {
    migrateInstanceMock.mockReset();
    invalidateQueriesMock.mockReset();
    useAppStore.setState({ activeView: { type: 'instances' }, activeTab: 'overview', currentUser: null });
  });

  it('submits the opposite mode by default and can request source deletion', async () => {
    migrateInstanceMock.mockResolvedValue({ id: 'openclaw-1', mode: 'profile' });
    const user = userEvent.setup();
    const { onClose } = renderDialog();

    expect(screen.getByRole('radio', { name: 'Docker' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Profile' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'migrateDeleteSource' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'migrateCta' }));

    await waitFor(() => {
      expect(migrateInstanceMock).toHaveBeenCalledWith('openclaw-1', {
        targetMode: 'profile',
        deleteSource: true,
      });
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['fleet'] });
    expect(onClose).toHaveBeenCalled();
    expect(useAppStore.getState().activeView).toEqual({ type: 'instance', id: 'openclaw-1' });
  });
});
