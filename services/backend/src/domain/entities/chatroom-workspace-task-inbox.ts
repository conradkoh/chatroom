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
 * Source for the slim header validator and the `WorkspaceTaskInboxTaskHeader` type that the
 * `listPending` view consumes; only read inside this module.
 */
const workspaceTaskInboxTaskHeaderFields = {
  taskId: v.id('chatroom_tasks'),
  chatroomId: v.id('chatroom_rooms'),
  status: v.string(),
  assignedTo: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startInNewSession: v.optional(v.boolean()),
};

const workspaceTaskInboxTaskHeaderValidator = v.object(workspaceTaskInboxTaskHeaderFields);
export type WorkspaceTaskInboxTaskHeader = Infer<typeof workspaceTaskInboxTaskHeaderValidator>;

/**
 * Legacy task snapshot fields. The writer no longer sets them. They exist only so rows written
 * before the slim header still validate. Read task content from `chatroom_tasks` instead.
 */
const legacyWorkspaceTaskInboxTaskFields = {
  /** @deprecated No longer written. Present only on pre-slim rows. */
  createdBy: v.optional(v.string()), // was required
  /** @deprecated No longer written. Read content from `chatroom_tasks`. */
  content: v.optional(v.string()), // was required
  /** @deprecated No longer written. Present only on pre-slim rows. */
  queuePosition: v.optional(v.number()), // was required
  /** @deprecated No longer written. Present only on pre-slim rows. */
  sourceMessageId: v.optional(v.id('chatroom_messages')),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  origin: v.optional(v.string()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  complexity: v.optional(v.string()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  value: v.optional(v.string()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  priority: v.optional(v.number()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  parentTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  acknowledgedAt: v.optional(v.number()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  startedAt: v.optional(v.number()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  completedAt: v.optional(v.number()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  plannerEnhancerEnabled: v.optional(v.boolean()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  conversationMode: v.optional(v.string()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  originUserMessageId: v.optional(v.id('chatroom_messages')),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  enhancerEnabledAtEnqueue: v.optional(v.boolean()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  taskEnvelope: v.optional(v.any()),
  /** @deprecated No longer written. Present only on pre-slim rows. */
  sessionPolicyConsumedAt: v.optional(v.number()),
};

const workspaceTaskInboxTaskValidator = v.object({
  ...workspaceTaskInboxTaskHeaderValidator.fields,
  ...legacyWorkspaceTaskInboxTaskFields,
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
