import { promoteNextTask, type PromoteNextTaskResult } from './promote-next-task';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { makePromoteNextTaskDeps } from '../../../../convex/lib/promoteNextTaskDeps';
import { getTeamEntryPoint } from '../../entities/team';

export type MaybePromoteNextQueuedTaskResult =
  | PromoteNextTaskResult
  | { promoted: null; reason: 'skipped_not_entry_point' };

export type MaybePromoteNextQueuedTaskOptions = {
  /** When set, promotion runs only if this role is the team entry point. */
  entryPointRole?: string;
};

// fallow-ignore-next-line complexity
export async function maybePromoteNextQueuedTask(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  options?: MaybePromoteNextQueuedTaskOptions
): Promise<MaybePromoteNextQueuedTaskResult> {
  if (options?.entryPointRole) {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    const entryPoint = getTeamEntryPoint(chatroom ?? {})?.toLowerCase();
    if (entryPoint !== options.entryPointRole.toLowerCase()) {
      return { promoted: null, reason: 'skipped_not_entry_point' };
    }
  }
  return promoteNextTask(chatroomId, makePromoteNextTaskDeps(ctx));
}
