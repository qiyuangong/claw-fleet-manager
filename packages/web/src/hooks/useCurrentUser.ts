import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '../api/users';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
  });
}
