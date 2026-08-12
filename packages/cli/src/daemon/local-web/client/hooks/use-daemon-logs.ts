import { useEffect, useState } from 'react';

import type { LogLine } from '../api/types';
import { getLogChatroomId, getLogHarness, getLogRole } from '../lib/log-line';
import { fetchLogDimensions, fetchLogHistory, subscribeLogStream } from '../lib/socket';

export type LogFilters = { chatroomId?: string; role?: string; harness?: string };
function matches(line: LogLine, f: LogFilters) {
  return (
    (!f.chatroomId || getLogChatroomId(line) === f.chatroomId) &&
    (!f.role || getLogRole(line) === f.role) &&
    (!f.harness || getLogHarness(line) === f.harness)
  );
}
function useDaemonLogsImpl(filters: LogFilters) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [dimensions, setDimensions] = useState({
    chatroomIds: [] as string[],
    roles: [] as string[],
    harnesses: [] as string[],
  });
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const d = await fetchLogDimensions();
        if (d.ok) setDimensions(d.data);
        const h = await fetchLogHistory({ ...filters, limit: 500 });
        if (!h.ok) throw new Error(h.error.message);
        setLines(h.data.entries);
        unsub = subscribeLogStream((l) => {
          if (matches(l, filters)) setLines((p) => [...p, l]);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load logs');
      } finally {
        setLoading(false);
      }
    })();
    return () => unsub?.();
  }, [filters.chatroomId, filters.role, filters.harness]);
  return { lines, dimensions, isLoading, error };
}
export function useDaemonLogs(filters: LogFilters = {}) {
  return useDaemonLogsImpl(filters);
}
