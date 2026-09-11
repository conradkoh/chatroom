import { AgentRoleLifecycleTag as WorkspaceTaskAssigneeType } from '@workspace/shared/domain/agent-role';
import { v } from 'convex/values';

export enum WorkspaceTaskInboxEventType {
  TaskAssigned = 'task_assigned',
  TaskUpdated = 'task_updated',
  TaskDeleted = 'task_deleted',
}

export enum WorkspaceTaskInboxEventStatus {
  Pending = 'pending',
  Processed = 'processed',
}

export { WorkspaceTaskAssigneeType };

const ephemeralAssigneeValidator = v.object({
  type: v.literal(WorkspaceTaskAssigneeType.Ephemeral),
  ephemeral: v.object({
    agentHarness: v.string(),
    model: v.string(),
    workingDir: v.string(),
  }),
});

const permanentAssigneeValidator = v.object({
  type: v.literal(WorkspaceTaskAssigneeType.Permanent),
});

const workspaceTaskAssigneeValidator = v.union(
  permanentAssigneeValidator,
  ephemeralAssigneeValidator
);

const workspaceTaskInboxEventStatusValidator = v.union(
  v.literal(WorkspaceTaskInboxEventStatus.Pending),
  v.literal(WorkspaceTaskInboxEventStatus.Processed)
);

/** The complete task payload needed by a daemon to handle an assignment. */
const workspaceTaskInboxTaskValidator = v.object({
  taskId: v.id('chatroom_tasks'),
  chatroomId: v.id('chatroom_rooms'),
  createdBy: v.string(),
  content: v.string(),
  status: v.string(),
  assignedTo: v.optional(v.string()),
  sourceMessageId: v.optional(v.id('chatroom_messages')),
  attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  origin: v.optional(v.string()),
  complexity: v.optional(v.string()),
  value: v.optional(v.string()),
  priority: v.optional(v.number()),
  parentTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  createdAt: v.number(),
  updatedAt: v.number(),
  acknowledgedAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  queuePosition: v.number(),
  plannerEnhancerEnabled: v.optional(v.boolean()),
  conversationMode: v.optional(v.string()),
  originUserMessageId: v.optional(v.id('chatroom_messages')),
  enhancerEnabledAtEnqueue: v.optional(v.boolean()),
  startInNewSession: v.optional(v.boolean()),
  taskEnvelope: v.optional(v.any()),
  sessionPolicyConsumedAt: v.optional(v.number()),
});

const workspaceTaskInboxEventFields = {
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
  taskId: v.id('chatroom_tasks'),
  role: v.string(),
  /** @deprecated Agent configuration moved to the daemon/agent process service. */
  agentHarness: v.optional(v.string()),
  /** @deprecated Agent configuration moved to the daemon/agent process service. */
  model: v.optional(v.string()),
  /** @deprecated Agent configuration moved to the daemon/agent process service. */
  workingDir: v.optional(v.string()),
  /** Assignment discriminator; absent only on legacy inbox rows. */
  assignee: v.optional(workspaceTaskAssigneeValidator),
  status: workspaceTaskInboxEventStatusValidator,
  task: workspaceTaskInboxTaskValidator,
  createdAt: v.number(),
  processedAt: v.optional(v.number()),
};

/** Event payload is discriminated so each event type has an explicit contract. */
export const workspaceTaskInboxEventValidator = v.union(
  v.object({
    ...workspaceTaskInboxEventFields,
    eventType: v.literal(WorkspaceTaskInboxEventType.TaskAssigned),
  }),
  v.object({
    ...workspaceTaskInboxEventFields,
    eventType: v.literal(WorkspaceTaskInboxEventType.TaskUpdated),
  }),
  v.object({
    ...workspaceTaskInboxEventFields,
    eventType: v.literal(WorkspaceTaskInboxEventType.TaskDeleted),
  })
);
