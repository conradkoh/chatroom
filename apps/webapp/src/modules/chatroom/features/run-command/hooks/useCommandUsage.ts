'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  getCommandUsageRevision,
  getCommandUsageStore,
  subscribeCommandUsage,
} from '../stores/commandUsageStore';

/** Device-local command usage (frécency). Prefer this over getCommandUsageStore() in hooks/UI. */
export function useCommandUsage() {
  const store = useMemo(() => getCommandUsageStore(), []);

  const revision = useSyncExternalStore(subscribeCommandUsage, getCommandUsageRevision, () => 0);

  const clearUsage = useCallback(() => {
    store.clear();
  }, [store]);

  return { clearUsage, revision };
}
