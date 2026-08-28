import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { applyAgentStopCommand } from './apply-agent-stop-command';
import { releaseEphemeralAgentRole } from './release-ephemeral-agent-role';
import { selectConfigsForAgentStop } from './select-agent-stop-configs';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function requestEphemeralAgentRelease(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const role = task.assignedTo?.trim();
  if (!role || !isEphemeralAgentRole(role)) return;
  const selectedConfigs = await selectConfigsForAgentStop(ctx, {
    chatroomId: task.chatroomId,
    scope: { kind: 'agent', role },
  });
  if (selectedConfigs.length) {
    await applyAgentStopCommand(ctx, {
      chatroomId: task.chatroomId,
      scope: { kind: 'agent', role },
      reason: 'platform.ephemeral_task_complete',
      selectedConfigs,
      postStopDesiredState: 'stopped',
    });
    return;
  }
  await releaseEphemeralAgentRole(ctx, { chatroomId: task.chatroomId, role });
}
