import { v } from 'convex/values';

export const workspaceTaskInboxEventTypeValidator = v.literal('task_assigned');
export const workspaceTaskInboxEventStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processed')
);

/** The complete task payload needed by a daemon to handle an assignment. */
export const workspaceTaskInboxTaskValidator = v.object({
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
