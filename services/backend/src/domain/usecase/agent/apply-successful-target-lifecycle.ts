import { agentExited } from './agent-exited';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function applySuccessfulTargetLifecycle(
  ctx: MutationCtx,
  args: { command: Doc<'chatroom_agentStopCommands'>; target: Doc<'chatroom_agentStopTargets'> }
): Promise<void> {
  const { target, command } = args;
  if (
    target.lifecycleAppliedAt != null ||
    target.status !== 'completed' ||
    !['stopped', 'already_stopped'].includes(target.outcome ?? '')
  )
    return;
  const result = await agentExited(ctx, {
    chatroomId: command.chatroomId,
    role: target.role,
    machineId: target.machineId,
    pid: target.pid,
    revisionKey: target.revisionKey,
    stopReason: command.reason,
  });
  if (result.applied) {
    await ctx.db.patch("chatroom_agentStopTargets", target._id, { lifecycleAppliedAt: Date.now() });
    await projectAgentOperationalStatusForRole(ctx, command.chatroomId, target.role);
  }
}
