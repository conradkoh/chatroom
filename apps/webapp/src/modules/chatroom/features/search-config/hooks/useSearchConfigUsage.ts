'use client';

import { useCallback, useMemo, useState } from 'react';

import type { SearchConfigEntry } from '../types/searchConfig';
import { getSearchConfigUsageStore } from '../stores/searchConfigUsageStore';

export function useSearchConfigUsage(machineId: string | null | undefined) {
  const [revision, setRevision] = useState(0);

  const scopeKey = machineId ?? '';

  const getAllUsage = useCallback((): Map<string, number[]> => {
    if (!machineId) return new Map();
    return getSearchConfigUsageStore().getAllUsageForScope(scopeKey);
  }, [machineId, scopeKey]);

  const getLastUsed = useCallback((): SearchConfigEntry | null => {
    if (!machineId) return null;
    void revision; // depend on revision so getLastUsed reflects new records
    const usage = getSearchConfigUsageStore().getAllUsageForScope(scopeKey);
    let lastEntry: SearchConfigEntry | null = null;
    let lastTs = 0;
    for (const [key, timestamps] of usage) {
      const maxTs = Math.max(...timestamps);
      if (maxTs > lastTs) {
        lastTs = maxTs;
        const pipeIdx = key.indexOf('|');
        if (pipeIdx !== -1) {
          lastEntry = { harnessName: key.slice(0, pipeIdx), modelKey: key.slice(pipeIdx + 1) };
        }
      }
    }
    return lastEntry;
  }, [machineId, scopeKey, revision]);

  const recordUsage = useCallback(
    (entry: SearchConfigEntry) => {
      if (!machineId) return;
      getSearchConfigUsageStore().recordUsage(scopeKey, entry);
      setRevision((v) => v + 1);
    },
    [machineId, scopeKey]
  );

  const clearUsage = useCallback(
    (entry: SearchConfigEntry) => {
      if (!machineId) return;
      getSearchConfigUsageStore().clearUsage(scopeKey, entry);
      setRevision((v) => v + 1);
    },
    [machineId, scopeKey]
  );

  return useMemo(
    () => ({ getAllUsage, getLastUsed, recordUsage, clearUsage }),
    [getAllUsage, getLastUsed, recordUsage, clearUsage]
  );
}
