/**
 * Centralized Agent Status Transition
 *
 * Projects an explicit daemon status observation to the thin role-status read
 * model. It does not write participant lifecycle mirrors, desired state, or
 * process state in Convex.
 */

import {
  projectAgentRoleStatusReadModel,
  statusEventForAgentEvent,
  type StatusEvent,
} from './project-agent-role-status-read-model';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Compatibility wrapper for explicit daemon lifecycle facts. New backend task
 * and message mutations must not call this function to infer agent status.
 *
 * @param ctx - Convex mutation context
 * @param chatroomId - The chatroom
 * @param role - The agent role
 * @param lastStatus - The new event type (e.g. 'agent.requestStart', 'agent.exited')
 * @param lastDesiredState - Optional desired lifecycle state ('running' | 'stopped')
 */
export async function transitionAgentStatus(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  lastStatus: string,
  _lastDesiredState?: string,
  statusEvent?: StatusEvent,
  projection?: {
    machineId?: string | undefined;
    emittedAt?: number | undefined;
    revisionKey?: string | undefined;
  }
): Promise<void> {
  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId,
    role,
    event: statusEvent ?? statusEventForAgentEvent(lastStatus),
    sourceMachineId: projection?.machineId,
    sourceEventAt: projection?.emittedAt,
    sourceRevisionKey: projection?.revisionKey,
  });
}
