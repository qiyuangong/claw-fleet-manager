import { useQuery } from '@tanstack/react-query';
import { getFleet } from '../api/fleet';

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

export function useFleet() {
  return useQuery({
    queryKey: ['fleet'],
    queryFn: getFleet,
    refetchInterval: () => visibleRefetchInterval(10_000),
  });
}
