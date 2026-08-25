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
import { selectConfigsForAgentStop, type AgentStopSelectedConfig } from './select-agent-stop-configs';

export interface RequestAgentStopInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: AgentStopReason;
  selectedConfigs?: AgentStopSelectedConfig[];
}

export interface RequestAgentStopResult {
  /** Empty — delivery is via machine command inbox. */
}

// fallow-ignore-next-line complexity
export async function requestAgentStop(
  ctx: MutationCtx,
  input: RequestAgentStopInput
): Promise<RequestAgentStopResult> {
  const selectedConfigs = input.selectedConfigs ?? await selectConfigsForAgentStop(ctx, { chatroomId: input.chatroomId, scope: { kind: 'agent', role: input.role }, machineId: input.machineId });
  await createAgentStopCommand(ctx, { chatroomId: input.chatroomId, scope: { kind: 'agent', role: input.role }, reason: input.reason, selectedConfigs });
  return {};
}
