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
    squad: {
      name: 'Squad',
      description: 'A planner, builder, and reviewer working as a coordinated team',
      roles: ['planner', 'builder', 'reviewer'],
      entryPoint: 'planner',
    },
  },
};
