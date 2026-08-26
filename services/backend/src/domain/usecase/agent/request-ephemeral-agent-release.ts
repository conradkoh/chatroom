import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { createAgentStopCommand } from './create-agent-stop-command';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
export async function requestEphemeralAgentRelease(ctx: MutationCtx, task: Doc<'chatroom_tasks'>): Promise<void> {
  const role = task.assignedTo?.trim();
  if (!role || !isEphemeralAgentRole(role)) return;
  const selectedConfigs = await selectConfigsForAgentStop(ctx, { chatroomId: task.chatroomId, scope: { kind: 'agent', role } });
  if (selectedConfigs.length) await createAgentStopCommand(ctx, { chatroomId: task.chatroomId, scope: { kind: 'agent', role }, reason: 'platform.ephemeral_task_complete', selectedConfigs, postStopDesiredState: 'running' });
}
