import { useQuery } from '@tanstack/react-query';
import { getFleet } from '../api/fleet';

export function useFleet() {
  return useQuery({
    queryKey: ['fleet'],
    queryFn: getFleet,
    refetchInterval: 5000,
  });
}
