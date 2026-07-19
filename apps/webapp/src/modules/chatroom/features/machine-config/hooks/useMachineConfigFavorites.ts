'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { useMachineConfigUsage } from './useMachineConfigUsage';
import {
  buildMachineFavoriteScopeKey,
  buildMachineConfigScopeKey,
} from '../lib/machineConfigScopeKey';
import type { MachineConfigEntry } from '../types/machineConfig';
import { entriesEqual } from '../types/machineConfig';

export interface MachineConfigFavoriteScope {
  machineId: string;
  chatroomId: string;
  teamId: string;
  role: string;
}

// fallow-ignore-next-line complexity
function isScopeComplete(
  scope: MachineConfigFavoriteScope | undefined
): scope is MachineConfigFavoriteScope {
  return Boolean(scope?.machineId && scope?.chatroomId && scope?.teamId && scope?.role);
}

// fallow-ignore-next-line complexity
export function useMachineConfigFavorites(scope: MachineConfigFavoriteScope | undefined) {
  const teamRoleKey = isScopeComplete(scope)
    ? buildMachineFavoriteScopeKey(scope.teamId, scope.role)
    : undefined;
  const scopeKey = isScopeComplete(scope)
    ? buildMachineConfigScopeKey(scope.machineId, scope.teamId, scope.role)
    : undefined;

  const { clearUsage } = useMachineConfigUsage(scopeKey);

  const queryResult = useSessionQuery(
    api.machineConfigFavorites.getMachineConfigFavorites,
    isScopeComplete(scope) && teamRoleKey ? { machineId: scope.machineId, teamRoleKey } : 'skip'
  );

  const setFavoritesMutation = useSessionMutation(
    api.machineConfigFavorites.setMachineConfigFavorites
  );

  const favorites = useMemo<MachineConfigEntry[]>(
    () => (queryResult as { favorites?: MachineConfigEntry[] })?.favorites ?? [],
    [queryResult]
  );

  const saveFavorites = useCallback(
    async (next: MachineConfigEntry[]) => {
      if (!isScopeComplete(scope) || !teamRoleKey) return;
      await setFavoritesMutation({
        machineId: scope.machineId,
        teamRoleKey,
        favorites: next,
      });
    },
    [scope, teamRoleKey, setFavoritesMutation]
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
      clearUsage(entry);
    },
    [favorites, saveFavorites, clearUsage]
  );

  const moveFavorite = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const inBounds = (index: number) => index >= 0 && index < favorites.length;
      if (!inBounds(fromIndex) || !inBounds(toIndex)) return;
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
