import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getInstanceConfig, saveInstanceConfig } from '../api/fleet';

export function useInstanceConfig(id: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['instanceConfig', id],
    queryFn: () => getInstanceConfig(id!),
    enabled: Boolean(id),
  });

  const mutation = useMutation({
    mutationFn: (config: unknown) => saveInstanceConfig(id!, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instanceConfig', id] });
    },
  });

  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
