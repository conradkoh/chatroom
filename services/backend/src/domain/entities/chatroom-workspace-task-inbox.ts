import { AgentRoleLifecycleTag as WorkspaceTaskAssigneeType } from '@workspace/shared/domain/agent-role';
import { type Infer, v } from 'convex/values';

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

/**
 * Task fields the daemon consumes from an inbox event. Heavy content is loaded on demand.
 * Intended for the Slice 2 `listPending` view, hence the unused-export suppression.
 */
// fallow-ignore-next-line unused-export
export const workspaceTaskInboxTaskHeaderFields = {
  taskId: v.id('chatroom_tasks'),
  chatroomId: v.id('chatroom_rooms'),
  status: v.string(),
  assignedTo: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startInNewSession: v.optional(v.boolean()),
};

/**
 * @deprecated Legacy snapshot fields. No longer written. Present only on rows written before
 * the slim header. Read task content from `chatroom_tasks` instead.
 */
const legacyWorkspaceTaskInboxTaskFields = {
  createdBy: v.optional(v.string()), // was required
  content: v.optional(v.string()), // was required
  queuePosition: v.optional(v.number()), // was required
  sourceMessageId: v.optional(v.id('chatroom_messages')),
  attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  origin: v.optional(v.string()),
  complexity: v.optional(v.string()),
  value: v.optional(v.string()),
  priority: v.optional(v.number()),
  parentTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  acknowledgedAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  plannerEnhancerEnabled: v.optional(v.boolean()),
  conversationMode: v.optional(v.string()),
  originUserMessageId: v.optional(v.id('chatroom_messages')),
  enhancerEnabledAtEnqueue: v.optional(v.boolean()),
  taskEnvelope: v.optional(v.any()),
  sessionPolicyConsumedAt: v.optional(v.number()),
};

const workspaceTaskInboxTaskValidator = v.object({
  ...workspaceTaskInboxTaskHeaderFields,
  ...legacyWorkspaceTaskInboxTaskFields,
});

// fallow-ignore-next-line unused-export
export const workspaceTaskInboxTaskHeaderValidator = v.object(workspaceTaskInboxTaskHeaderFields);
// fallow-ignore-next-line unused-type
export type WorkspaceTaskInboxTaskHeader = Infer<typeof workspaceTaskInboxTaskHeaderValidator>;

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
