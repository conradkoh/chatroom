import {
  reassignTasksOnTeamSwitch,
  releaseTasksOnAgentExit,
  shouldReleaseTasksOnAgentExit,
} from '../../domain/usecase/task/release-tasks-on-agent-exit';
import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  stopReason?: string;
  agentHarness?: string;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * Crash recovery restarts are owned by the daemon. On unexpected exit, release
 * in-flight tasks for this role so get-next-task can reclaim them immediately.
 *
 * `platform.team_switch` reassigns tasks to the new team entry point instead of
 * releasing them unassigned. `user.stop` and `daemon.shutdown` release to pending.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  if (args.stopReason === 'platform.team_switch') {
    await reassignTasksOnTeamSwitch(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
    return;
  }

  if (!shouldReleaseTasksOnAgentExit(args.stopReason)) {
    return;
  }

  await releaseTasksOnAgentExit(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
}
