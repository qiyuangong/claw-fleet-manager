import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getFleetSessionsHistory } from '../api/fleet';
import type { FleetSessionsHistoryQuery } from '../types';
import { useAppStore } from '../store';

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

type UseFleetSessionsHistoryOptions = {
  query: FleetSessionsHistoryQuery;
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export function useFleetSessionsHistory(options: UseFleetSessionsHistoryOptions) {
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const refetchIntervalMs = options.refetchIntervalMs ?? 15_000;
  const enabled = options.enabled ?? true;
  const [historyDisabled, setHistoryDisabled] = useState(
    () => typeof window !== 'undefined' && window.sessionStorage.getItem('__fleet_history_disabled__') === '1',
  );

  const query = useQuery({
    queryKey: ['fleetSessionsHistory', options.query],
    queryFn: async () => {
      try {
        return await getFleetSessionsHistory(options.query);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && typeof window !== 'undefined') {
          window.sessionStorage.setItem('__fleet_history_disabled__', '1');
          setHistoryDisabled(true);
        }
        throw error;
      }
    },
    enabled: isAdmin && enabled && !historyDisabled,
    retry: false,
    refetchInterval: () => visibleRefetchInterval(refetchIntervalMs),
  });

  const isHistoryDisabled = historyDisabled
    || (query.error instanceof ApiError && query.error.status === 404);

  return {
    ...query,
    historyDisabled: isHistoryDisabled,
  };
}
