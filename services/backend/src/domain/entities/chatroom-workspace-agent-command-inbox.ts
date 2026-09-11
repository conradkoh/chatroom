import { v } from 'convex/values';

const WorkspaceAgentCommandType = {
  StopAllAgents: 'stop_all_agents',
  StopAgent: 'stop_agent',
} as const;

const workspaceAgentCommandInboxStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed')
);

const workspaceAgentCommandInboxCommandValidator = v.union(
  v.object({
    type: v.literal(WorkspaceAgentCommandType.StopAllAgents),
    finalizeChatroom: v.optional(v.boolean()),
  }),
  v.object({ type: v.literal(WorkspaceAgentCommandType.StopAgent), role: v.string() })
);

export const workspaceAgentCommandInboxValidator = v.object({
  operationId: v.string(),
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
  command: workspaceAgentCommandInboxCommandValidator,
  status: workspaceAgentCommandInboxStatusValidator,
  createdAt: v.number(),
  processingAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});
