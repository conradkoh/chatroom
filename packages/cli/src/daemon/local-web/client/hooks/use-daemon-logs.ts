import { useEffect, useState } from 'react';

import type { LogLine } from '../api/types';
import { getLogChatroomId, getLogHarness, getLogRole } from '../lib/log-line';
import { resolveTimeRange } from '../lib/log-time-range';
import { fetchLogDimensions, fetchLogHistory, subscribeLogStream } from '../lib/socket';

export type LogFilters = {
  chatroomId?: string;
  role?: string;
  harness?: string;
  timeRange?: '1h' | '3h' | '1d' | 'custom';
  fromMs?: number;
  toMs?: number;
};
function matches(line: LogLine, f: LogFilters) {
  const range = resolveTimeRange(f);
  return (
    line.timestamp >= range.fromMs &&
    line.timestamp <= range.toMs &&
    getLogChatroomId(line) === f.chatroomId &&
    (!f.role || getLogRole(line) === f.role) &&
    (!f.harness || getLogHarness(line) === f.harness)
  );
}
function useDaemonLogsImpl(filters: LogFilters) {
  const chatroomId = filters.chatroomId;
  const [lines, setLines] = useState<LogLine[]>([]);
  const [dimensions, setDimensions] = useState({
    roles: [] as string[],
    harnesses: [] as string[],
  });
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!chatroomId) {
      setLines([]);
      setDimensions({ roles: [], harnesses: [] });
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let active = true;
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const d = await fetchLogDimensions(chatroomId);
        if (!active) return;
        if (d.ok) setDimensions(d.data);
        const range = resolveTimeRange(filters);
        const h = await fetchLogHistory({
          chatroomId,
          role: filters.role,
          harness: filters.harness,
          fromTimestamp: range.fromMs,
          toTimestamp: range.toMs,
          limit: 500,
        });
        if (!h.ok) throw new Error(h.error.message);
        if (!active) return;
        setLines(h.data.entries.filter((line) => matches(line, filters)));
        unsub = subscribeLogStream((l) => {
          if (matches(l, filters)) setLines((p) => [...p, l]);
        });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load logs');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      unsub?.();
    };
  }, [chatroomId, filters.role, filters.harness, filters.timeRange, filters.fromMs, filters.toMs]);
  return { lines, dimensions, isLoading, error };
}
export function useDaemonLogs(filters: LogFilters = {}) {
  return useDaemonLogsImpl(filters);
}
