// fallow-ignore-file complexity

import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '../../entities/chatroom-workspace-task-inbox';

const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

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

  const targets = new Map<
    string,
    { machineId: string; role: string; agentHarness?: string; model?: string; workingDir?: string }
  >();
  if (eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
    const existingEvents = await ctx.db
      .query('chatroomWorkspaceTaskInbox')
      .withIndex('by_chatroom_taskId', (q) =>
        q.eq('chatroomId', task.chatroomId).eq('taskId', task._id)
      )
      .collect();
    for (const event of existingEvents) {
      targets.set(`${event.machineId}:${event.role.toLowerCase()}`, {
        machineId: event.machineId,
        role: event.role,
        ...(event.agentHarness ? { agentHarness: event.agentHarness } : {}),
        ...(event.model ? { model: event.model } : {}),
        ...(event.workingDir ? { workingDir: event.workingDir } : {}),
      });
    }
  }
  for (const config of configs) {
    if (
      config.type === 'remote' &&
      config.machineId &&
      config.role.toLowerCase() === assignedRole.toLowerCase()
    ) {
      targets.set(`${config.machineId}:${config.role.toLowerCase()}`, {
        machineId: config.machineId,
        role: config.role,
        ...(config.agentHarness ? { agentHarness: config.agentHarness } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.workingDir ? { workingDir: config.workingDir } : {}),
      });
    }
  }

  for (const target of targets.values()) {
    await ctx.db.insert('chatroomWorkspaceTaskInbox', {
      machineId: target.machineId,
      chatroomId: task.chatroomId,
      taskId: task._id,
      role: target.role,
      ...(target.agentHarness ? { agentHarness: target.agentHarness } : {}),
      ...(target.model ? { model: target.model } : {}),
      ...(target.workingDir ? { workingDir: target.workingDir } : {}),
      eventType,
      status: WorkspaceTaskInboxEventStatus.Pending,
      task: taskPayload,
      createdAt: Date.now(),
    });
  }
}

/** Replays active tasks to a role when a remote daemon config becomes available. */
export async function writeWorkspaceTaskInboxEventsForRole(
  ctx: MutationCtx,
  args: {
    chatroomId: Doc<'chatroom_rooms'>['_id'];
    role: string;
    eventType: WorkspaceTaskInboxEventType;
  }
): Promise<void> {
  const tasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
    .collect();
  for (const task of tasks) {
    if (
      !ACTIVE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_TASK_STATUSES)[number]) ||
      task.assignedTo?.toLowerCase() !== args.role.toLowerCase()
    ) {
      continue;
    }
    await writeWorkspaceTaskInboxEvent(ctx, args.eventType, task);
  }
}
