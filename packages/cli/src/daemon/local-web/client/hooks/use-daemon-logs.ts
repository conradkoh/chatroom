import { useEffect, useState } from 'react';

import type { LogLine } from '../api/types';
import { getLogChatroomId, getLogHarness, getLogRole } from '../lib/log-line';
import {
  fetchLogDimensions,
  fetchLogHistory,
  fetchLogSources,
  subscribeLogStream,
} from '../lib/socket';

export type LogFilters = { chatroomId?: string; role?: string; harness?: string; source?: string };
function matches(line: LogLine, f: LogFilters) {
  return (
    (!f.source || line.source === f.source) &&
    (!f.chatroomId || getLogChatroomId(line) === f.chatroomId) &&
    (!f.role || getLogRole(line) === f.role) &&
    (!f.harness || getLogHarness(line) === f.harness)
  );
}
function useDaemonLogsImpl(filters: LogFilters) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [sources, setSources] = useState<string[]>([]);
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
        const [d, s] = await Promise.all([fetchLogDimensions(), fetchLogSources()]);
        if (d.ok) setDimensions(d.data);
        if (s.ok) setSources(s.data.sources);
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
  }, [filters.chatroomId, filters.role, filters.harness, filters.source]);
  return { lines, sources, dimensions, isLoading, error };
}
export function useDaemonLogs(sourceFilter?: string): ReturnType<typeof useDaemonLogsImpl>;
export function useDaemonLogs(filters: LogFilters): ReturnType<typeof useDaemonLogsImpl>;
export function useDaemonLogs(arg?: string | LogFilters) {
  return useDaemonLogsImpl(typeof arg === 'string' ? { source: arg } : (arg ?? {}));
}
