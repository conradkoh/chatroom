/**
 * Ensures a machineId is allowed for a chatroom role before mutating team agent config
 * or dispatching start-related commands.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

export type AssertMachineBelongsToChatroomArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  /** When false, rejects new bindings and machine switches unless the bound machine matches. */
  allowNewMachine: boolean;
};

/**
 * Reads `chatroom_teamAgentConfigs` for the current team + role and validates `machineId`.
 *
 * - Bound machine matches `machineId` → OK.
 * - Bound machine differs → OK only if `allowNewMachine` is true; otherwise throws (message mentions allowNewMachine).
 * - No binding (no row or no machineId on row) → OK only if `allowNewMachine` is true; otherwise throws.
 */
export async function assertMachineBelongsToChatroom(
  ctx: QueryCtx | MutationCtx,
  args: AssertMachineBelongsToChatroomArgs
): Promise<void> {
  const { chatroomId, machineId, role, allowNewMachine } = args;

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!chatroom?.teamId) {
    throw new Error('Chatroom has no teamId — cannot verify machine binding for this role');
  }

  const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  const boundMachineId = existing?.machineId;
  if (boundMachineId === machineId) {
    return;
  }

  if (boundMachineId != null && boundMachineId !== machineId) {
    if (!allowNewMachine) {
      throw new Error(
        'This role is already bound to a different machine. ' +
          'Pass allowNewMachine: true in the start-agent command payload to switch machines.'
      );
    }
    return;
  }

  if (!allowNewMachine) {
    throw new Error(
      'No machine binding exists for this role yet. ' +
        'Pass allowNewMachine: true in the start-agent command payload to create the binding.'
    );
  }
}
