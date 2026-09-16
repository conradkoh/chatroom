import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';
import {
  reassignTasksOnTeamSwitch,
} from '../../domain/usecase/task/release-tasks-on-agent-exit';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  stopReason?: string | undefined;
  agentHarness?: string | undefined;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * The backend no longer infers task-state transitions from agent exits. In-flight
 * task recovery is daemon-owned: the daemon releases the tasks it tracks through
 * the scoped `releaseTaskAfterTurnFailure` path (turn failures, daemon shutdown)
 * and re-delivers `pending`/`acknowledged` tasks on reconcile. This removes the
 * role-wide release race where a planned restart's exit release destroyed the
 * replacement session's claim (incident 2026-09-16, plan R1/R2).
 *
 * `platform.team_switch` remains backend-owned: tasks reassign to the new team
 * entry point instead of releasing unassigned.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  if (args.stopReason === 'platform.team_switch') {
    await reassignTasksOnTeamSwitch(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
    });
  }
}
