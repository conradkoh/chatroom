import { getTeamStructure } from '../../src/domain/entities/team-presets';
import { getActiveTeamStructure } from '../../src/domain/usecase/team/active-team-structure';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type DbCtx = QueryCtx | MutationCtx;

/**
 * Resolves the active immutable team definition into the legacy-shaped view
 * expected by older domain helpers. The assignment table remains the only
 * source used to populate these fields; callers must not persist them.
 */
export async function withActiveTeamStructure(
  ctx: DbCtx,
  chatroom: Doc<'chatroom_rooms'>
): Promise<
  Doc<'chatroom_rooms'> & {
    teamId?: string;
    teamName?: string;
    teamRoles?: string[];
    teamEntryPoint?: string;
  }
> {
  const active = await getActiveTeamStructure(ctx, chatroom._id);
  if (!active) return chatroom;
  const structure = getTeamStructure({ teamId: active.teamStructureId });
  return {
    ...chatroom,
    teamId: structure.teamId,
    teamName: structure.teamName,
    teamRoles: structure.roles.map(({ role }) => role),
    teamEntryPoint: structure.entryPoint,
  };
}
