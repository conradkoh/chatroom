import { useEffect, useState } from 'react';

import type { EventStreamEntry } from '../api/types';
import { fetchEventStreamHistory, subscribeEventStream } from '../lib/socket';

export function useEventStream(chatroomId: string | undefined) {
  const [entries, setEntries] = useState<EventStreamEntry[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chatroomId) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const response = await fetchEventStreamHistory({ chatroomId, limit: 500 });
        if (!response.ok) throw new Error(response.error.message);
        if (active) {
          setEntries(response.data.entries);
          unsubscribe = subscribeEventStream((entry) => {
            const eventChatroomId = entry.payload?.chatroomId;
            if (typeof eventChatroomId !== 'string' || eventChatroomId !== chatroomId) return;
            setEntries((prev) => prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]);
          });
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Failed to load event stream');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [chatroomId]);

  return { entries, isLoading, error };
}
