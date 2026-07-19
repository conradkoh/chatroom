'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  getCommandFavoritesRevision,
  getCommandFavoritesStore,
  subscribeCommandFavorites,
} from '../stores/commandFavoritesStore';

/**
 * React hook wrapping the CommandFavoritesStore singleton.
 *
 * - `favorites`: a Set<string> of favorited command names (re-computed on toggle).
 * - `toggle(name)`: adds or removes a command from favorites, bumps revision.
 * - `isFavorite(name)`: fast O(1) membership check.
 */
export function useCommandFavorites() {
  const store = useMemo(() => getCommandFavoritesStore(), []);

  const revision = useSyncExternalStore(
    subscribeCommandFavorites,
    getCommandFavoritesRevision,
    () => 0
  );

  const favorites = useMemo(() => {
    void revision;
    return store.getAll();
  }, [store, revision]);

  const toggle = useCallback((commandName: string) => store.toggle(commandName), [store]);

  const isFavorite = useCallback((commandName: string) => favorites.has(commandName), [favorites]);

  return { favorites, toggle, isFavorite, revision };
}
