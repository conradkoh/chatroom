export interface TeamDefinition {
  name: string;
  description: string;
  roles: string[];
  entryPoint?: string;
}

export interface TeamsConfig {
  defaultTeam: string;
  teams: Record<string, TeamDefinition>;
}

export const TEAMS_CONFIG: TeamsConfig = {
  defaultTeam: 'duo',
  teams: {
    duo: {
      name: 'Duo',
      description: 'A planner and builder working as a pair, planner as coordinator',
      roles: ['planner', 'builder'],
      entryPoint: 'planner',
    },
    solo: {
      name: 'Solo',
      description: 'A single agent working independently, with optional on-demand builder',
      roles: ['solo', 'builder'],
      entryPoint: 'solo',
    },
  },
};
