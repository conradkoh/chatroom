/**
 * Use Case: Request Agent Stop
 *
 * Records stop intent and enqueues `agent.requestStop` for the daemon.
 * Does not clear PID, transition participant status, or release tasks —
 * those happen only after the daemon confirms harness termination.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentStopReason } from '../../entities/agent';
import { createAgentStopCommand } from './create-agent-stop-command';

export interface RequestAgentStopInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: AgentStopReason;
}

export interface RequestAgentStopResult {
  /** Empty — delivery is via machine command inbox. */
}

// fallow-ignore-next-line complexity
export async function requestAgentStop(
  ctx: MutationCtx,
  input: RequestAgentStopInput
): Promise<RequestAgentStopResult> {
  await createAgentStopCommand(ctx, { chatroomId: input.chatroomId, scope: { kind: 'agent', role: input.role }, reason: input.reason, machineId: input.machineId });
  return {};
}
