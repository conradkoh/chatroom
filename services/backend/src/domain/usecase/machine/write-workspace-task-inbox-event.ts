// fallow-ignore-file complexity

import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import {
  WorkspaceTaskInboxEventStatus,
  type WorkspaceTaskInboxEventType,
} from '../../entities/chatroom-workspace-task-inbox';

/** Writes a task lifecycle event to every remote agent responsible for the task's role. */
export async function writeWorkspaceTaskInboxEvent(
  ctx: MutationCtx,
  eventType: WorkspaceTaskInboxEventType,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const assignedRole = task.assignedTo;
  if (!assignedRole || assignedRole.toLowerCase() === 'user') {
    return;
  }

  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
    .collect();

  const taskPayload = omitUndefined({
    taskId: task._id,
    chatroomId: task.chatroomId,
    createdBy: task.createdBy,
    content: task.content,
    status: task.status,
    assignedTo: task.assignedTo,
    sourceMessageId: task.sourceMessageId,
    attachedTaskIds: task.attachedTaskIds,
    origin: task.origin,
    complexity: task.complexity,
    value: task.value,
    priority: task.priority,
    parentTaskIds: task.parentTaskIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    acknowledgedAt: task.acknowledgedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    queuePosition: task.queuePosition,
    plannerEnhancerEnabled: task.plannerEnhancerEnabled,
    conversationMode: task.conversationMode,
    originUserMessageId: task.originUserMessageId,
    enhancerEnabledAtEnqueue: task.enhancerEnabledAtEnqueue,
    startInNewSession: task.startInNewSession,
    taskEnvelope: task.taskEnvelope,
    sessionPolicyConsumedAt: task.sessionPolicyConsumedAt,
  });

  for (const config of configs) {
    if (
      config.type !== 'remote' ||
      !config.machineId ||
      config.role.toLowerCase() !== assignedRole.toLowerCase()
    ) {
      continue;
    }

    await ctx.db.insert('chatroomWorkspaceTaskInbox', {
      machineId: config.machineId,
      chatroomId: task.chatroomId,
      taskId: task._id,
      eventType,
      status: WorkspaceTaskInboxEventStatus.Pending,
      task: taskPayload,
      createdAt: Date.now(),
    });
  }
}
