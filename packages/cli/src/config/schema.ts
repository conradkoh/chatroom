/**
 * Configuration Schema
 *
 * Defines the structure of .chatroom/chatroom.jsonc configuration files.
 */

/**
 * Definition of an agent team
 */
export interface TeamDefinition {
  /** Display name for the team */
  name: string;
  /** Human-readable description of the team's purpose */
  description: string;
  /** List of role IDs that make up this team (order defines workflow priority) */
  roles: string[];
  /** Role that receives all user messages (defaults to first role in roles array) */
  entryPoint?: string;
}

/**
 * Configuration for prompt overrides
 */
export interface PromptsConfig {
  /** Path to custom init prompt file (replaces entire init prompt) */
  initPrompt?: string;
  /** System reminder configuration */
  systemReminders?: {
    /** Whether system reminders are enabled (default: true) */
    enabled?: boolean;
    /** Path to custom wait reminder file */
    waitReminder?: string;
  };
}

/**
 * Root configuration structure for .chatroom/chatroom.jsonc
 */
export interface ChatroomConfig {
  /** ID of the team to use when --team is not specified */
  defaultTeam: string;
  /** Map of team ID to team definition */
  teams: Record<string, TeamDefinition>;
  /** Optional prompt customization */
  prompts?: PromptsConfig;
}

/**
 * Validate that a configuration object is valid
 */
export function validateConfig(config: unknown): config is ChatroomConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Check defaultTeam
  if (typeof c.defaultTeam !== 'string' || c.defaultTeam.length === 0) {
    return false;
  }

  // Check teams
  if (!c.teams || typeof c.teams !== 'object') {
    return false;
  }

  const teams = c.teams as Record<string, unknown>;

  // Validate each team
  for (const [, team] of Object.entries(teams)) {
    if (!team || typeof team !== 'object') {
      return false;
    }

    const t = team as Record<string, unknown>;

    if (typeof t.name !== 'string' || t.name.length === 0) {
      return false;
    }

    if (typeof t.description !== 'string') {
      return false;
    }

    if (!Array.isArray(t.roles) || t.roles.length === 0) {
      return false;
    }

    if (!t.roles.every((r) => typeof r === 'string' && r.length > 0)) {
      return false;
    }
  }

  // Check that defaultTeam exists in teams
  if (!(c.defaultTeam in teams)) {
    return false;
  }

  return true;
}

/**
 * Get validation errors for a configuration (for better error messages)
 */
export function getConfigErrors(config: unknown): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Configuration must be an object');
    return errors;
  }

  const c = config as Record<string, unknown>;

  if (typeof c.defaultTeam !== 'string' || c.defaultTeam.length === 0) {
    errors.push("'defaultTeam' must be a non-empty string");
  }

  if (!c.teams || typeof c.teams !== 'object') {
    errors.push("'teams' must be an object");
    return errors;
  }

  const teams = c.teams as Record<string, unknown>;

  if (Object.keys(teams).length === 0) {
    errors.push("'teams' must contain at least one team");
  }

  for (const [teamId, team] of Object.entries(teams)) {
    if (!team || typeof team !== 'object') {
      errors.push(`Team '${teamId}' must be an object`);
      continue;
    }

    const t = team as Record<string, unknown>;

    if (typeof t.name !== 'string' || t.name.length === 0) {
      errors.push(`Team '${teamId}' must have a non-empty 'name'`);
    }

    if (typeof t.description !== 'string') {
      errors.push(`Team '${teamId}' must have a 'description'`);
    }

    if (!Array.isArray(t.roles)) {
      errors.push(`Team '${teamId}' must have a 'roles' array`);
    } else if (t.roles.length === 0) {
      errors.push(`Team '${teamId}' must have at least one role`);
    } else if (!t.roles.every((r) => typeof r === 'string' && r.length > 0)) {
      errors.push(`Team '${teamId}' roles must all be non-empty strings`);
    }
  }

  if (
    typeof c.defaultTeam === 'string' &&
    c.teams &&
    typeof c.teams === 'object' &&
    !(c.defaultTeam in (c.teams as object))
  ) {
    errors.push(`'defaultTeam' value '${c.defaultTeam}' does not exist in 'teams'`);
  }

  return errors;
}
