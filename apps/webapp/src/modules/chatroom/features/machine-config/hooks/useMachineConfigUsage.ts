'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { MachineConfigEntry } from '../../../types/machineConfig';
import {
  getMachineConfigUsageRevision,
  getMachineConfigUsageStore,
  subscribeMachineConfigUsage,
} from '../stores/machineConfigUsageStore';

/**
 * React hook for machine-config usage (device-local frécency).
 * Components should use this instead of calling getMachineConfigUsageStore() directly.
 */
export function useMachineConfigUsage(scopeKey: string | undefined) {
  const store = useMemo(() => getMachineConfigUsageStore(), []);

  const revision = useSyncExternalStore(
    subscribeMachineConfigUsage,
    getMachineConfigUsageRevision,
    () => 0
  );

  const usageForScope = useMemo(() => {
    if (!scopeKey) return new Map<string, number[]>();
    void revision;
    return store.getAllUsageForScope(scopeKey);
  }, [store, scopeKey, revision]);

  const recordUsage = useCallback(
    (entry: MachineConfigEntry) => {
      if (!scopeKey) return;
      store.recordUsage(scopeKey, entry);
    },
    [store, scopeKey]
  );

  const clearUsage = useCallback(
    (entry: MachineConfigEntry) => {
      if (!scopeKey) return;
      store.clearUsage(scopeKey, entry);
    },
    [store, scopeKey]
  );

  return { usageForScope, recordUsage, clearUsage };
}
