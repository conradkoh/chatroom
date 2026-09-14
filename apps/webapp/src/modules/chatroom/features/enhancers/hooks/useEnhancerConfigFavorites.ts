'use client';

import { useCallback, useMemo } from 'react';

import { useMachineConfigFavorites } from '../../machine-config/hooks/useMachineConfigFavorites';
import type { MachineConfigFavoriteScope } from '../../machine-config/hooks/useMachineConfigFavorites';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';
import {
  enhancerConfigEntriesEqual,
  normalizeEnhancerTargetId,
} from '../types/enhancerConfigEntry';

export function useEnhancerConfigFavorites(scope: MachineConfigFavoriteScope | undefined) {
  const {
    favorites: machineFavorites,
    addFavorite: addMachineFavorite,
    removeFavorite: removeMachineFavorite,
    moveFavorite: moveMachineFavorite,
    isLoading,
  } = useMachineConfigFavorites(scope);

  const favorites = useMemo<EnhancerConfigEntry[]>(
    () =>
      machineFavorites.map((entry) => ({
        targetId: normalizeEnhancerTargetId(undefined),
        agentHarness: entry.agentHarness,
        model: entry.model,
      })),
    [machineFavorites]
  );

  const addFavorite = useCallback(
    async (entry: EnhancerConfigEntry) => {
      if (favorites.some((f) => enhancerConfigEntriesEqual(f, entry))) return;
      await addMachineFavorite({ agentHarness: entry.agentHarness, model: entry.model });
    },
    [addMachineFavorite, favorites]
  );

  const removeFavorite = useCallback(
    async (entry: EnhancerConfigEntry) => {
      const index = favorites.findIndex((favorite) => enhancerConfigEntriesEqual(favorite, entry));
      if (index >= 0) await removeMachineFavorite(machineFavorites[index]);
    },
    [favorites, machineFavorites, removeMachineFavorite]
  );

  const moveFavorite = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const inBounds = (i: number) => i >= 0 && i < favorites.length;
      if (!inBounds(fromIndex) || !inBounds(toIndex)) return;
      await moveMachineFavorite(fromIndex, toIndex);
    },
    [favorites.length, moveMachineFavorite]
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
    isLoading,
  };
}
