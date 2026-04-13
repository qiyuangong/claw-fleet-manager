import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstanceActivityTab } from './InstanceActivityTab';
import { useAppStore } from '../../store';

const mockUseFleetSessions = vi.fn();

vi.mock('../../hooks/useFleetSessions', () => ({
  useFleetSessions: () => mockUseFleetSessions(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('InstanceActivityTab', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentUser: { username: 'admin', role: 'admin', assignedProfiles: [] },
    });

    mockUseFleetSessions.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            sessions: [],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });
  });

  it('does not render the empty-state copy when the selected instance has a fetch error', () => {
    mockUseFleetSessions.mockReturnValue({
      data: {
        instances: [
          {
            instanceId: 'alpha',
            error: 'Unreachable',
            sessions: [],
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    render(<InstanceActivityTab instanceId="alpha" />);

    expect(screen.getByText('Unreachable')).not.toBeNull();
    expect(screen.queryByText('instanceActivityEmpty')).toBeNull();
    expect(screen.queryByText('noSessionsFilter')).toBeNull();
  });
});
