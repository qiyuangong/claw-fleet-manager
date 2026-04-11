// packages/web/src/hooks/useFleetSessions.ts
import { useQuery } from '@tanstack/react-query';
import { getFleetSessions } from '../api/fleet';
import { useAppStore } from '../store';

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

export function useFleetSessions() {
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';

  return useQuery({
    queryKey: ['fleetSessions'],
    queryFn: getFleetSessions,
    enabled: isAdmin,
    refetchInterval: () => visibleRefetchInterval(15_000),
  });
}
