// fallow-ignore-file unused-file
// Temporary: the cutover writer slice will consume this use case.
import { AGENT_STOP_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentDaemonCommandPayload } from '../../entities/agent-daemon-command';
import type { AgentStopReason, AgentStopScope } from '../../entities/agent-stop-command';

export interface EnqueueAgentStopCommandInput {
  machineId: string;
  intentId: string;
  chatroomId: Id<'chatroom_rooms'>;
  scope: AgentStopScope;
  reason: AgentStopReason;
  targets?: { role: string; pid: number }[] | undefined;
  now?: number | undefined;
}

/** Insert a pending agent.stop command, deriving its deadline from now. */
export async function enqueueAgentStopCommand(
  ctx: MutationCtx,
  input: EnqueueAgentStopCommandInput
) {
  const now = input.now ?? Date.now();
  const command: AgentDaemonCommandPayload = {
    type: 'agent.stop',
    intentId: input.intentId,
    chatroomId: input.chatroomId,
    scope: input.scope,
    reason: input.reason,
    ...(input.targets && input.targets.length > 0 ? { targets: input.targets } : {}),
  };
  return await ctx.db.insert('chatroom_agentCommandInbox', {
    machineId: input.machineId,
    command,
    createdAt: now,
    deadlineAt: now + AGENT_STOP_REQUEST_DEADLINE_MS,
    attemptCount: 0,
    status: 'pending',
  });
}
