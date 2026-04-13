import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddInstanceDialog } from '../src/components/instances/AddInstanceDialog';

const createInstanceMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const useFleetConfigMock = vi.fn();

vi.mock('../src/api/fleet', () => ({
  createInstance: (...args: unknown[]) => createInstanceMock(...args),
}));

vi.mock('../src/hooks/useFleetConfig', () => ({
  useFleetConfig: () => useFleetConfigMock(),
}));

function renderDialog(kind: 'docker' | 'profile') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(invalidateQueriesMock);

  render(
    <QueryClientProvider client={queryClient}>
      <AddInstanceDialog kind={kind} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('AddInstanceDialog', () => {
  beforeEach(() => {
    createInstanceMock.mockReset();
    invalidateQueriesMock.mockReset();
    useFleetConfigMock.mockReset();
    useFleetConfigMock.mockReturnValue({
      data: {
        openclawImage: 'openclaw:local',
        cpuLimit: '2',
        memLimit: '4g',
        portStep: 20,
        enableNpmPackages: true,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates Docker advanced overrides from fleet config and submits them', async () => {
    createInstanceMock.mockResolvedValue({ id: 'team-alpha' });
    const user = userEvent.setup();

    renderDialog('docker');

    await user.type(screen.getByPlaceholderText('dockerInstanceNamePlaceholder'), 'Team-Alpha');
    await user.click(screen.getByRole('button', { name: 'showDockerConfig' }));

    expect(screen.getByDisplayValue('openclaw:local')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4g')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();

    await user.clear(screen.getByDisplayValue('openclaw:local'));
    await user.type(screen.getByLabelText('openclawImage'), 'ghcr.io/acme/openclaw:latest');
    await user.clear(screen.getByDisplayValue('2'));
    await user.type(screen.getByLabelText('cpuLimit'), '4');
    await user.clear(screen.getByDisplayValue('4g'));
    await user.type(screen.getByLabelText('memLimit'), '8g');
    await user.clear(screen.getByDisplayValue('20'));
    await user.type(screen.getByLabelText('portStep'), '30');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'createDockerInstanceCta' }));

    await waitFor(() => {
      expect(createInstanceMock).toHaveBeenCalledWith({
        runtime: 'openclaw',
        kind: 'docker',
        name: 'team-alpha',
        image: 'ghcr.io/acme/openclaw:latest',
        cpuLimit: '4',
        memoryLimit: '8g',
        portStep: 30,
        enableNpmPackages: false,
      });
    });
  });

  it('submits profile instances with sanitized numeric port and no Docker overrides', async () => {
    createInstanceMock.mockResolvedValue({ id: 'rescue-team' });
    const user = userEvent.setup();

    renderDialog('profile');

    await user.type(screen.getByPlaceholderText('profileNamePlaceholder'), 'Rescue-Team');
    await user.type(screen.getByPlaceholderText('gatewayPortPlaceholder'), '9a87');
    await user.click(screen.getByRole('button', { name: 'createProfileCta' }));

    await waitFor(() => {
      expect(createInstanceMock).toHaveBeenCalledWith({
        runtime: 'openclaw',
        kind: 'profile',
        name: 'rescue-team',
        port: 987,
      });
    });
  });
});
