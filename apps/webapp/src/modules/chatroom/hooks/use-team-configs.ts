/**
 * Centralised access to UI team configuration.
 *
 * Single source of truth for which teams appear in pickers.
 * Backed by TEAMS_CONFIG from config/teams.ts.
 *
 * @see apps/webapp/src/modules/chatroom/config/teams.ts
 * @see apps/webapp/src/modules/chatroom/config/teams.spec.ts
 */

import { useMemo } from 'react';

import { TEAMS_CONFIG } from '../config/teams';

export interface TeamConfigEntry {
  id: string;
  name: string;
  description: string;
  roles: string[];
  entryPoint?: string;
}

/**
 * Hook returning the UI-visible team configurations.
 *
 * - `teams`: ordered array (iteration order of TEAMS_CONFIG.teams).
 *   If ordering must match backend, sort by WELL_KNOWN_TEAM_KINDS index.
 * - `defaultTeamId`: the default team kind.
 * - `getById`: lookup helper.
 */
export function useTeamConfigs() {
  return useMemo(() => {
    const entries = Object.entries(TEAMS_CONFIG.teams);
    const teams: readonly TeamConfigEntry[] = entries.map(([id, data]) => ({
      id,
      name: data.name,
      description: data.description,
      roles: data.roles,
      entryPoint: data.entryPoint,
    }));

    const map = new Map<string, TeamConfigEntry>(teams.map((t) => [t.id, t]));

    return {
      teams,
      defaultTeamId: TEAMS_CONFIG.defaultTeam,
      getById: (id: string) => map.get(id),
    };
  }, []);
}
