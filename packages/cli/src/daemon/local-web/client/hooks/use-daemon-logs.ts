import { useEffect, useState } from 'react';

import type { LogLine } from '../api/types';
import { getLogChatroomId, getLogHarness, getLogRole } from '../lib/log-line';
import { fetchLogDimensions, fetchLogHistory, subscribeLogStream } from '../lib/socket';
import { resolveTimeRange } from '../lib/log-time-range';

export type LogFilters = { chatroomId?: string; role?: string; harness?: string; timeRange?: '1h'|'3h'|'1d'|'custom'; fromMs?: number; toMs?: number };
function matches(line: LogLine, f: LogFilters) {
  const range=resolveTimeRange(f);
  return (
    line.timestamp>=range.fromMs && line.timestamp<=range.toMs &&
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
        const range=resolveTimeRange(filters); const h = await fetchLogHistory({ ...filters, fromTimestamp:range.fromMs, toTimestamp:range.toMs, limit: 500 });
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
  }, [filters.chatroomId, filters.role, filters.harness, filters.timeRange, filters.fromMs, filters.toMs]);
  return { lines, dimensions, isLoading, error };
}
export function useDaemonLogs(filters: LogFilters = {}) {
  return useDaemonLogsImpl(filters);
}
