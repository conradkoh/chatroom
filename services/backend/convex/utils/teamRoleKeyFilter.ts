import type { Doc, Id } from '../_generated/dataModel';

export function teamRoleKeyMatchesTeam(
  teamRoleKey: string,
  chatroomId: Id<'chatroom_rooms'> | string,
  teamId: string
): boolean {
  return teamRoleKey.startsWith(`chatroom_${chatroomId}#team_${teamId.toLowerCase()}#`);
}

/** Keep only configs for the chatroom's current team (preserved historical rows are excluded). */
export function filterTeamAgentConfigsForTeam(
  configs: Doc<'chatroom_teamAgentConfigs'>[],
  chatroomId: Id<'chatroom_rooms'> | string,
  teamId: string | undefined | null
): Doc<'chatroom_teamAgentConfigs'>[] {
  if (!teamId) return configs;
  return configs.filter((c) => teamRoleKeyMatchesTeam(c.teamRoleKey, chatroomId, teamId));
}
