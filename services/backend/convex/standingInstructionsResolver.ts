/**
 * Shared read-time resolution of a chatroom's standing instructions.
 *
 * When a chatroom is linked to a user preset (chatroom_standingInstructionHistory
 * via standingInstructionPresetId), content/title resolve from the live preset so
 * preset edits propagate immediately to every referencing chatroom (fixing
 * cross-chatroom staleness and the scheduled-task delivery edge case). Rooms
 * without a link fall back to their denormalized fields.
 */

import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { ResolvedStandingInstruction } from '../src/domain/entities/standing-instructions';

type StandingInstructionCtx = Pick<QueryCtx | MutationCtx, 'db'>;

// fallow-ignore-next-line complexity
export async function resolveStandingInstructionForRoom(
  ctx: StandingInstructionCtx,
  room: Doc<'chatroom_rooms'>
): Promise<ResolvedStandingInstruction> {
  if (room.standingInstructionPresetId) {
    const preset = await ctx.db.get(
      'chatroom_standingInstructionHistory',
      room.standingInstructionPresetId
    );
    if (preset) {
      return {
        content: preset.content,
        title: preset.title ?? '',
        enabled: room.standingInstructionsEnabled ?? false,
        presetId: preset._id,
      };
    }
  }
  // Fallback to denormalized fields (legacy / unlinked rooms)
  return {
    content: room.standingInstructions ?? '',
    title: room.standingInstructionsTitle ?? '',
    enabled: room.standingInstructionsEnabled ?? false,
  };
}
