// packages/web/src/hooks/useFleetSessions.ts
import { useQuery } from '@tanstack/react-query';
import { getFleetSessions } from '../api/fleet';
import { useAppStore } from '../store';

type UseFleetSessionsOptions = {
  refetchIntervalMs?: number;
  enabled?: boolean;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  previewLimit?: number;
};

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

export function useFleetSessions(options?: UseFleetSessionsOptions) {
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const refetchIntervalMs = options?.refetchIntervalMs ?? 15_000;
  const enabled = options?.enabled ?? true;
  const status = options?.status;
  const previewLimit = options?.previewLimit;

  return useQuery({
    queryKey: ['fleetSessions', status ?? 'all', previewLimit ?? 0],
    queryFn: () => getFleetSessions({ status, previewLimit }),
    enabled: isAdmin && enabled,
    refetchInterval: () => visibleRefetchInterval(refetchIntervalMs),
  });
}
