import { v } from 'convex/values';

import { agentStopReasonValidator } from './agent';
import { agentStopScopeValidator } from './agent-stop-command';

export const agentDaemonCommandPayloadValidator = v.union(
  v.object({
    type: v.literal('agent.stop'),
    intentId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    scope: agentStopScopeValidator,
    reason: agentStopReasonValidator,
  })
);
export type AgentDaemonCommandPayload = typeof agentDaemonCommandPayloadValidator.type;
