import { useQuery } from '@tanstack/react-query';

import { fetchHealth } from '@/lib/socket';

export function useDaemonHealth() {
  return useQuery({
    queryKey: ['daemon', 'health'],
    queryFn: async () => {
      const ack = await fetchHealth();
      if (!ack.ok) {
        throw new Error(ack.error.message);
      }
      return ack.data;
    },
    retry: 2,
  });
}
