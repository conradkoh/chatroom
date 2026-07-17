'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { useSearchConfigUsage } from './useSearchConfigUsage';
import type { SearchConfigEntry } from '../types/searchConfig';
import { searchConfigEntriesEqual } from '../types/searchConfig';

export function useSearchConfigFavorites(machineId: string | null | undefined) {
  const enabled = Boolean(machineId);
  const { clearUsage } = useSearchConfigUsage(machineId);

  const queryResult = useSessionQuery(
    api.searchConfigFavorites.getSearchConfigFavorites as any,
    enabled && machineId ? ({ machineId } as any) : 'skip'
  );

  const setFavoritesMutation = useSessionMutation(
    api.searchConfigFavorites.setSearchConfigFavorites as any
  );

  const favorites = useMemo<SearchConfigEntry[]>(
    () => (queryResult as { favorites?: SearchConfigEntry[] })?.favorites ?? [],
    [queryResult]
  );

  const saveFavorites = useCallback(
    async (next: SearchConfigEntry[]) => {
      if (!machineId) return;
      await setFavoritesMutation({ machineId, favorites: next } as any);
    },
    [machineId, setFavoritesMutation]
  );

  const addFavorite = useCallback(
    async (entry: SearchConfigEntry) => {
      if (favorites.some((f) => searchConfigEntriesEqual(f, entry))) return;
      await saveFavorites([...favorites, entry]);
    },
    [favorites, saveFavorites]
  );

  const removeFavorite = useCallback(
    async (entry: SearchConfigEntry) => {
      const next = favorites.filter((f) => !searchConfigEntriesEqual(f, entry));
      await saveFavorites(next);
      clearUsage(entry);
    },
    [favorites, saveFavorites, clearUsage]
  );

  const moveFavorite = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const inBounds = (i: number) => i >= 0 && i < favorites.length;
      if (!inBounds(fromIndex) || !inBounds(toIndex)) return;
      const next = [...favorites];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      await saveFavorites(next);
    },
    [favorites, saveFavorites]
  );

  const isFavorite = useCallback(
    (entry: SearchConfigEntry) => favorites.some((f) => searchConfigEntriesEqual(f, entry)),
    [favorites]
  );

  return {
    favorites,
    addFavorite,
    removeFavorite,
    moveFavorite,
    isFavorite,
    isLoading: enabled && queryResult === undefined,
  };
}
