import { useEffect, useState } from 'react';

import type { EventStreamEntry } from '../api/types';
import type { EventStreamFilterValues } from '../lib/event-stream-filters-url';
import { resolveTimeRange } from '../lib/log-time-range';
import { fetchEventStreamHistory, subscribeEventStream } from '../lib/socket';

export function useEventStream(filters: EventStreamFilterValues) {
  const chatroomId = filters.chatroomId;
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
        const range = resolveTimeRange(filters);
        const response = await fetchEventStreamHistory({
          chatroomId,
          fromTimestamp: range.fromMs,
          toTimestamp: range.toMs,
          limit: 500,
        });
        if (!response.ok) throw new Error(response.error.message);
        if (active) {
          setEntries(response.data.entries);
          unsubscribe = subscribeEventStream((entry) => {
            const eventChatroomId = entry.payload?.chatroomId;
            const range = resolveTimeRange(filters);
            if (
              entry.timestamp < range.fromMs ||
              entry.timestamp > range.toMs ||
              typeof eventChatroomId !== 'string' ||
              eventChatroomId !== chatroomId
            )
              return;
            setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
          });
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Failed to load event stream');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [chatroomId, filters.timeRange, filters.fromMs, filters.toMs]);

  return { entries, isLoading, error };
}
