import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFleetConfig, saveFleetConfig } from '../api/fleet';

export function useFleetConfig() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['fleetConfig'],
    queryFn: getFleetConfig,
  });

  const mutation = useMutation({
    mutationFn: saveFleetConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fleetConfig'] });
    },
  });

  return { ...query, save: mutation.mutateAsync, saving: mutation.isPending };
}
