/**
 * Ensures a machineId is allowed for a chatroom role before mutating desired agent config
 * or dispatching start-related commands.
 */

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { getTeamStructure } from '../../entities/team-presets';
import { getActiveTeamStructure } from '../team/active-team-structure';

export type AssertMachineBelongsToChatroomArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  /** When false, rejects new bindings and machine switches unless the bound machine matches. */
  allowNewMachine: boolean;
};

/**
 * Reads the latest submitted launch request for the current team + role and validates `machineId`.
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
  if (!chatroom) throw new Error('Chatroom not found');
  const activeStructure = await getActiveTeamStructure(ctx, chatroomId);
  const structureId =
    activeStructure?.teamStructureId ??
    (chatroom.teamId ? getTeamStructure({ teamId: chatroom.teamId }).teamStructureId : undefined);
  const existing = structureId
    ? await getLastSentLaunchRequestForRole(ctx, {
        chatroomId,
        role,
        teamStructureId: structureId,
      })
    : null;

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
