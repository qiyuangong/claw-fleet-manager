import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddInstanceDialog } from './AddInstanceDialog';

const createInstanceMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock('../../api/fleet', () => ({
  createInstance: (...args: unknown[]) => createInstanceMock(...args),
}));

vi.mock('../../hooks/useFleetConfig', () => ({
  useFleetConfig: () => ({ data: undefined }),
}));

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(invalidateQueriesMock);

  render(
    <QueryClientProvider client={queryClient}>
      <AddInstanceDialog runtime="hermes" kind="profile" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('AddInstanceDialog', () => {
  beforeEach(() => {
    createInstanceMock.mockReset();
    invalidateQueriesMock.mockReset();
  });

  it('submits runtime and kind when creating a Hermes profile instance', async () => {
    createInstanceMock.mockResolvedValue({ id: 'research-bot' });
    const user = userEvent.setup();

    renderDialog();

    await user.type(screen.getByPlaceholderText('profileNamePlaceholder'), 'research-bot');
    expect(screen.queryByPlaceholderText('gatewayPortPlaceholder')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'createHermesProfileCta' }));

    await waitFor(() => {
      expect(createInstanceMock).toHaveBeenCalledWith({
        runtime: 'hermes',
        kind: 'profile',
        name: 'research-bot',
      });
    });
  });

  it('keeps main reserved for managed profiles across runtimes', async () => {
    renderDialog();

    await userEvent.setup().type(screen.getByPlaceholderText('profileNamePlaceholder'), 'main');

    expect(screen.getByText('profileNameReserved')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'createHermesProfileCta' }).hasAttribute('disabled')).toBe(true);
  });
});
