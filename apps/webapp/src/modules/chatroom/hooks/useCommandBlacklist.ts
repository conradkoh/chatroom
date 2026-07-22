'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  getCommandBlacklistStore,
  subscribeCommandBlacklist,
  getCommandBlacklistRevision,
} from '../features/run-command/stores/commandBlacklistStore';

export function useCommandBlacklist() {
  const store = useMemo(() => getCommandBlacklistStore(), []);
  const revision = useSyncExternalStore(
    subscribeCommandBlacklist,
    getCommandBlacklistRevision,
    () => 0
  );
  const blacklistedIds = useMemo(() => {
    void revision;
    return store.getAll();
  }, [store, revision]);

  const blacklist = useCallback((commandId: string) => store.add(commandId), [store]);
  const unblacklist = useCallback((commandId: string) => store.remove(commandId), [store]);
  const isBlacklisted = useCallback((commandId: string) => store.has(commandId), [store]);

  return { blacklistedIds, blacklist, unblacklist, isBlacklisted };
}
