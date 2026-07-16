'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { getMachineConfigUsageStore } from '../lib/machineConfigUsageStore';
import type { MachineConfigEntry } from '../types/machineConfig';
import { entriesEqual } from '../types/machineConfig';

// fallow-ignore-next-line complexity
export function useMachineConfigFavorites(machineId: string | undefined) {
  const queryResult = useSessionQuery(
    api.machines.getMachineConfigFavorites,
    machineId ? { machineId } : 'skip'
  );

  const setFavoritesMutation = useSessionMutation(api.machines.setMachineConfigFavorites);

  const favorites = useMemo<MachineConfigEntry[]>(
    () => (queryResult as { favorites?: MachineConfigEntry[] })?.favorites ?? [],
    [queryResult]
  );

  const saveFavorites = useCallback(
    async (next: MachineConfigEntry[]) => {
      if (!machineId) return;
      await setFavoritesMutation({ machineId, favorites: next });
    },
    [machineId, setFavoritesMutation]
  );

  const addFavorite = useCallback(
    async (entry: MachineConfigEntry) => {
      if (favorites.some((f) => entriesEqual(f, entry))) return;
      const next = [...favorites, entry];
      await saveFavorites(next);
    },
    [favorites, saveFavorites]
  );

  const removeFavorite = useCallback(
    async (entry: MachineConfigEntry) => {
      const next = favorites.filter((f) => !entriesEqual(f, entry));
      await saveFavorites(next);
      if (machineId) {
        getMachineConfigUsageStore().clearUsage(machineId, entry);
      }
    },
    [favorites, saveFavorites, machineId]
  );

  const moveFavorite = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (fromIndex < 0 || fromIndex >= favorites.length) return;
      if (toIndex < 0 || toIndex >= favorites.length) return;
      const next = [...favorites];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      await saveFavorites(next);
    },
    [favorites, saveFavorites]
  );

  const isFavorite = useCallback(
    (entry: MachineConfigEntry) => favorites.some((f) => entriesEqual(f, entry)),
    [favorites]
  );

  return { favorites, addFavorite, removeFavorite, moveFavorite, isFavorite };
}
