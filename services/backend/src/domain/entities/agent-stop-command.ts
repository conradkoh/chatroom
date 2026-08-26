// fallow-ignore-file unused-export unused-type
import { v } from 'convex/values';

import { agentStopReasonValidator, type AgentStopReason } from './agent';

export {
  agentStopScopeKey,
  buildAgentStopRevisionKey,
  buildAgentStopTargetKey,
  normalizeAgentStopRole,
} from '@workspace/shared/domain/agent-stop-command';
export type {
  AgentStopScope,
  AgentStopTargetDescriptor,
} from '@workspace/shared/domain/agent-stop-command';

export const agentStopScopeValidator = v.union(
  v.object({ kind: v.literal('chatroom') }),
  v.object({ kind: v.literal('agent'), role: v.string() })
);

export { agentStopReasonValidator, type AgentStopReason };

export const agentStopStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('superseded')
);
export type AgentStopStatus = typeof agentStopStatusValidator.type;

export const agentStopTargetStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('superseded')
);
export type AgentStopTargetStatus = typeof agentStopTargetStatusValidator.type;
