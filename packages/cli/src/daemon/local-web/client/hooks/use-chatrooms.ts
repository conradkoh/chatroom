import { useQuery } from '@tanstack/react-query';

import { fetchChatrooms } from '@/lib/socket';

export function useChatrooms() {
  return useQuery({
    queryKey: ['daemon', 'chatrooms'],
    queryFn: async () => {
      const ack = await fetchChatrooms();
      if (!ack.ok) throw new Error(ack.error.message);
      return ack.data.chatrooms;
    },
    staleTime: 60_000,
  });
}
