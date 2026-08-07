'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';
import { enhancerConfigEntriesEqual } from '../types/enhancerConfigEntry';

export function useEnhancerConfigFavorites(machineId: string | null | undefined) {
  const enabled = Boolean(machineId);

  const queryResult = useSessionQuery(
    api.enhancerConfigFavorites.getEnhancerConfigFavorites,
    enabled && machineId ? { machineId } : 'skip'
  );

  const setFavoritesMutation = useSessionMutation(
    api.enhancerConfigFavorites.setEnhancerConfigFavorites
  );

  const favorites = useMemo<EnhancerConfigEntry[]>(
    () => (queryResult as { favorites?: EnhancerConfigEntry[] })?.favorites ?? [],
    [queryResult]
  );

  const saveFavorites = useCallback(
    async (next: EnhancerConfigEntry[]) => {
      if (!machineId) return;
      await setFavoritesMutation({ machineId, favorites: next });
    },
    [machineId, setFavoritesMutation]
  );

  const addFavorite = useCallback(
    async (entry: EnhancerConfigEntry) => {
      if (favorites.some((f) => enhancerConfigEntriesEqual(f, entry))) return;
      await saveFavorites([...favorites, entry]);
    },
    [favorites, saveFavorites]
  );

  const removeFavorite = useCallback(
    async (entry: EnhancerConfigEntry) => {
      const next = favorites.filter((f) => !enhancerConfigEntriesEqual(f, entry));
      await saveFavorites(next);
    },
    [favorites, saveFavorites]
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
    (entry: EnhancerConfigEntry) => favorites.some((f) => enhancerConfigEntriesEqual(f, entry)),
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
