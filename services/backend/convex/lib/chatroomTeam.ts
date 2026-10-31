import type { TeamRosterEntry } from '@workspace/shared/domain/custom-agent';

import {
  resolveChatroomTeam,
  type ResolvedCustomAgent,
} from '../../src/domain/usecase/team/resolve-chatroom-team';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type DbCtx = QueryCtx | MutationCtx;

export type ResolvedChatroom = Doc<'chatroom_rooms'> & {
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  roster?: TeamRosterEntry[];
  customAgents?: ResolvedCustomAgent[];
};

/**
 * Resolves the active immutable team definition into the legacy-shaped view
 * expected by older domain helpers. The assignment table remains the only
 * source used to populate these fields; callers must not persist them.
 *
 * Custom agents and machine-local disabled flags are merged through
 * `resolveChatroomTeam`, so every consumer sees the same team. With no customs
 * and no disabled roles the result matches the static structure exactly.
 */
export async function withActiveTeamStructure(
  ctx: DbCtx,
  chatroom: Doc<'chatroom_rooms'>
): Promise<ResolvedChatroom> {
  const resolved = await resolveChatroomTeam(ctx, chatroom._id);
  if (!resolved) return chatroom;
  return {
    ...chatroom,
    teamId: resolved.structure.teamId,
    teamName: resolved.structure.teamName,
    teamRoles: resolved.structure.roles.map(({ role }) => role),
    teamEntryPoint: resolved.structure.entryPoint,
    roster: resolved.roster,
    customAgents: resolved.enabledCustomAgents,
  };
}
