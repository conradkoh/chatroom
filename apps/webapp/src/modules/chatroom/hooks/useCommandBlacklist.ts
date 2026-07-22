'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { getCommandBlacklistKey } from '../lib/commandBlacklistKey';
import type { CommandItem } from '../components/CommandPalette/types';
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
  const blacklistedKeys = useMemo(() => {
    void revision;
    return store.getAll();
  }, [store, revision]);

  const blacklist = useCallback(
    (command: CommandItem) => store.add(getCommandBlacklistKey(command)),
    [store]
  );
  const unblacklist = useCallback(
    (command: CommandItem) => store.remove(getCommandBlacklistKey(command)),
    [store]
  );
  const isBlacklisted = useCallback(
    (command: CommandItem) => store.has(getCommandBlacklistKey(command)),
    [store]
  );

  return { blacklistedKeys, blacklist, unblacklist, isBlacklisted };
}
