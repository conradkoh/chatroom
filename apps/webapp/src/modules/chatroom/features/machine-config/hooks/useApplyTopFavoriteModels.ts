'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useQueries } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  applyFavoriteConfigsAndRestart,
  type ApplyFavoriteConfigItem,
} from '../lib/applyFavoriteConfigs';
import { buildMachineFavoriteScopeKey } from '../lib/machineConfigScopeKey';
import {
  resolveTopFavoritePerRole,
  type ApplyTopFavoritesResult,
  type RoleTopFavorite,
} from '../lib/topFavoriteModels';
import type { MachineConfigEntry } from '../types/machineConfig';

/** Where top favourites are applied: one workspace (machine + working dir) and the team's roles. */
export interface ApplyTopFavoritesTarget {
  chatroomId: string;
  /** Workspace registry id (`Workspace._registryId`). */
  workspaceId: string;
  machineId: string;
  workingDir: string;
  teamId: string;
  roles: readonly string[];
}

/** Maps each role's top favourite to a save item for the target workspace. */
function toApplyItems(
  target: ApplyTopFavoritesTarget,
  topFavorites: readonly RoleTopFavorite[]
): ApplyFavoriteConfigItem[] {
  return topFavorites.map(({ role, entry }) => ({
    chatroomId: target.chatroomId as Id<'chatroom_rooms'>,
    workspaceId: target.workspaceId as Id<'chatroom_workspaces'>,
    machineId: target.machineId,
    workingDir: target.workingDir,
    role,
    entry,
  }));
}

/** Loads each role's favourites for the target team and applies each role's top favourite. */
// fallow-ignore-next-line complexity
export function useApplyTopFavoriteModels(target: ApplyTopFavoritesTarget | null) {
  const [sessionId] = useSessionId();
  const machineId = target?.machineId;
  const teamId = target?.teamId;
  const roles = target?.roles;

  // fallow-ignore-next-line complexity
  const favoriteQueries = useMemo(() => {
    if (!sessionId || !machineId || !teamId || !roles) return {};
    return Object.fromEntries(
      roles.map((role) => [
        role,
        {
          query: api.machineConfigFavorites.getMachineConfigFavorites,
          args: { sessionId, machineId, teamRoleKey: buildMachineFavoriteScopeKey(teamId, role) },
        },
      ])
    );
  }, [sessionId, machineId, teamId, roles]);
  const favoriteResults = useQueries(favoriteQueries);

  // fallow-ignore-next-line complexity
  const topFavorites = useMemo<RoleTopFavorite[]>(() => {
    if (!roles) return [];
    const byRole = new Map<string, readonly MachineConfigEntry[]>();
    for (const role of roles) {
      const result = favoriteResults[role] as
        { favorites?: MachineConfigEntry[] } | Error | undefined;
      if (result && !(result instanceof Error)) byRole.set(role, result.favorites ?? []);
    }
    return resolveTopFavoritePerRole(roles, byRole);
  }, [roles, favoriteResults]);

  const isLoading =
    target !== null &&
    (!sessionId || (roles ?? []).some((role) => favoriteResults[role] === undefined));

  const applyConfig = useSessionMutation(api.agents.applyConfig);
  const inFlightRef = useRef(false);
  const [isApplying, setIsApplying] = useState(false);

  const apply = useCallback(async (): Promise<ApplyTopFavoritesResult | null> => {
    if (!target || topFavorites.length === 0 || inFlightRef.current) return null;
    inFlightRef.current = true;
    setIsApplying(true);
    try {
      return await applyFavoriteConfigsAndRestart(applyConfig, toApplyItems(target, topFavorites));
    } finally {
      inFlightRef.current = false;
      setIsApplying(false);
    }
  }, [target, topFavorites, applyConfig]);

  return { topFavorites, isLoading, isApplying, apply };
}
