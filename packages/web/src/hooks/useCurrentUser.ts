import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '../api/users';
import { isApiClientLoggedOut } from '../api/client';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    staleTime: 60_000,
    retry: false,
    enabled: !isApiClientLoggedOut(),
  });
}
