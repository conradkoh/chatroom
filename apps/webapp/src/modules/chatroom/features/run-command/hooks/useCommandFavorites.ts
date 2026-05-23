'use client';

import { useCallback, useMemo, useState } from 'react';
import { getCommandFavoritesStore } from '../../../lib/commandFavoritesStore';

/**
 * React hook wrapping the CommandFavoritesStore singleton.
 *
 * - `favorites`: a Set<string> of favorited command names (re-computed on toggle).
 * - `toggle(name)`: adds or removes a command from favorites, bumps version.
 * - `isFavorite(name)`: fast O(1) membership check.
 */
export function useCommandFavorites() {
  const [version, setVersion] = useState(0);
  const store = useMemo(() => getCommandFavoritesStore(), []);

  const favorites = useMemo(
    () => store.getAll(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, version]
  );

  const toggle = useCallback(
    (commandName: string) => {
      store.toggle(commandName);
      setVersion((v) => v + 1);
    },
    [store]
  );

  const isFavorite = useCallback(
    (commandName: string) => favorites.has(commandName),
    [favorites]
  );

  return { favorites, toggle, isFavorite, version };
}
