/**
 * Use case: record a team-structure switch.
 *
 * Team switching changes the active structural assignment. It does not seed
 * agent configuration, reconcile daemon processes, or start/stop agents. Any
 * lifecycle change must be an explicit command whose payload is sent to the
 * daemon.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { reassignInFlightTasksOnTeamSwitch } from '../task/release-tasks-on-agent-exit';

export interface UpdateTeamInput {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
}

export interface UpdateTeamResult {
  /** No lifecycle commands are issued by a structural switch. */
  stoppedAgentCount: 0;
  /** Legacy counters retained while callers migrate away from this result. */
  preservedCount: 0;
  restoredCount: 0;
  seededCount: 0;
  /** No lifecycle commands are issued by a structural switch. */
  startedAgentCount: 0;
}

export async function updateTeam(
  ctx: MutationCtx,
  input: UpdateTeamInput
): Promise<UpdateTeamResult> {
  // Task routing is a domain consequence of changing the active entry point;
  // it is not agent lifecycle reconciliation.
  await reassignInFlightTasksOnTeamSwitch(ctx, input.chatroomId);

  return {
    stoppedAgentCount: 0,
    preservedCount: 0,
    restoredCount: 0,
    seededCount: 0,
    startedAgentCount: 0,
  };
}
