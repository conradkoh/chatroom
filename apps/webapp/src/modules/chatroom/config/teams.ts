import { TEAM_PRESET_IDS, type TeamPresetId } from '@workspace/shared/domain/team-kind';
import {
  DEFAULT_TEAM_PRESET_ID,
  getPermanentRolesForPreset,
  TEAM_PRESETS,
} from '@workspace/shared/domain/team-presets';

export interface TeamDefinition {
  name: string;
  description: string;
  roles: string[];
  entryPoint: string;
}

export interface TeamsConfig {
  defaultTeam: string;
  teams: Record<string, TeamDefinition>;
}

const TEAM_PICKER_DESCRIPTIONS = {
  duo: 'A planner and builder working as a pair, planner as coordinator',
  solo: 'A single agent working independently',
} satisfies Record<TeamPresetId, string>;

export const TEAMS_CONFIG = {
  defaultTeam: DEFAULT_TEAM_PRESET_ID,
  // Object.fromEntries erases the finite key union; source IDs remain checked above.
  teams: Object.fromEntries(
    TEAM_PRESET_IDS.map((teamId) => [
      teamId,
      {
        name: TEAM_PRESETS[teamId].name,
        description: TEAM_PICKER_DESCRIPTIONS[teamId],
        roles: [...getPermanentRolesForPreset(teamId)],
        entryPoint: TEAM_PRESETS[teamId].entryPoint,
      },
    ])
  ) as Record<TeamPresetId, TeamDefinition>,
} satisfies TeamsConfig;
