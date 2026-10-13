/**
 * Use Case: Create Chatroom With Workspace
 *
 * Creates a chatroom and registers its first workspace in one mutation. Every check runs before
 * the first write, so invalid input leaves no partial state behind. The mutation transaction is
 * the second line of defence, not the first.
 */

import { ConvexError } from 'convex/values';

import { insertChatroomWithTeam } from './create-chatroom';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';
import { getTeamPreset } from '../../entities/team-presets';
import { registerWorkspace } from '../workspace/register-workspace';

/** Chatroom names come from the working dir's last segment and are capped at this length. */
const CHATROOM_NAME_MAX_LENGTH = 100;

interface CreateChatroomWithWorkspaceInput {
  ownerId: Id<'users'>;
  teamStructureId: string;
  machineId: string;
  workingDir: string;
}

/** Last non-empty path segment, capped. `undefined` when the path has no usable segment. */
function deriveChatroomName(normalizedWorkingDir: string): string | undefined {
  const segment = normalizedWorkingDir.split('/').filter(Boolean).pop() ?? '';
  return segment.slice(0, CHATROOM_NAME_MAX_LENGTH) || undefined;
}

export async function createChatroomWithWorkspace(
  ctx: MutationCtx,
  input: CreateChatroomWithWorkspaceInput
): Promise<{ chatroomId: Id<'chatroom_rooms'>; workspaceId: Id<'chatroom_workspaces'> }> {
  // ── Validate everything before the first write ──

  // getTeamStructure falls back for unknown ids, so check the preset explicitly.
  if (!getTeamPreset(input.teamStructureId)) {
    throw new ConvexError({
      code: 'UNKNOWN_TEAM_STRUCTURE',
      message: `Unknown team structure: ${input.teamStructureId}`,
    });
  }

  // Throws on relative paths, '~' and shell metacharacters.
  const workingDir = normalizeWorkingDir(input.workingDir);
  if (workingDir === '') {
    throw new Error('Workspace path cannot be the filesystem root');
  }

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .first();
  if (!machine) {
    throw new ConvexError({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
  }

  // ── Writes (one transaction) ──

  const chatroomId = await insertChatroomWithTeam(ctx, {
    ownerId: input.ownerId,
    teamStructureId: input.teamStructureId,
    name: deriveChatroomName(workingDir),
  });
  const workspaceId = await registerWorkspace(ctx, {
    chatroomId,
    machineId: input.machineId,
    workingDir,
    hostname: machine.hostname,
    registeredBy: 'user',
  });
  // A brand-new chatroom has no primary workspace yet, so write the row directly rather than
  // calling the session-authenticated setPrimaryWorkspaceForChatroom mutation.
  await ctx.db.insert('chatroom_primaryWorkspaces', {
    chatroomId,
    workspaceId,
    updatedAt: Date.now(),
  });

  return { chatroomId, workspaceId };
}
