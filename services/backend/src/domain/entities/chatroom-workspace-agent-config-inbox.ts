import { v } from 'convex/values';

import { agentTypeValidator } from './agent';

export enum WorkspaceAgentConfigInboxStatus {
  Pending = 'pending',
  Processed = 'processed',
}

const workspaceAgentConfigInboxStatusValidator = v.union(
  v.literal(WorkspaceAgentConfigInboxStatus.Pending),
  v.literal(WorkspaceAgentConfigInboxStatus.Processed)
);

/**
 * Agent configuration event for workspace daemons. Written in the same
 * mutation as task inbox events targeting the same `(machineId, role)`, so a
 * task event is never processed before its config event.
 */
export const workspaceAgentConfigInboxEventValidator = v.object({
  machineId: v.string(),
  chatroomId: v.id('chatroom_rooms'),
  role: v.string(),
  agentType: agentTypeValidator,
  agentHarness: v.string(),
  model: v.string(),
  workingDir: v.string(),
  status: workspaceAgentConfigInboxStatusValidator,
  createdAt: v.number(),
  processedAt: v.optional(v.number()),
});
