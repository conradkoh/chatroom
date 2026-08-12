import { useEffect, useState } from 'react';
import { fetchLogHistory, fetchLogSources, subscribeLogStream } from '../lib/socket';
import type { LogLine } from '../api/types';

export function useDaemonLogs(sourceFilter?: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const sourcesAck = await fetchLogSources();
        if (sourcesAck.ok) setSources(sourcesAck.data.sources);
        const historyAck = await fetchLogHistory({ source: sourceFilter, limit: 500 });
        if (!historyAck.ok) throw new Error(historyAck.error.message);
        setLines(historyAck.data.entries);
        unsub = subscribeLogStream((line) => {
          if (!sourceFilter || line.source === sourceFilter) setLines((prev) => [...prev, line]);
        });
      } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load logs'); }
      finally { setIsLoading(false); }
    })();
    return () => unsub?.();
  }, [sourceFilter]);
  return { lines, sources, isLoading, error };
}
