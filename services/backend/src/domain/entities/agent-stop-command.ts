// fallow-ignore-file unused-export unused-type
import { v } from 'convex/values';

import { agentStopReasonValidator, type AgentStopReason } from './agent';

export const agentStopScopeValidator = v.union(
  v.object({ kind: v.literal('chatroom') }),
  v.object({ kind: v.literal('agent'), role: v.string() })
);
export type AgentStopScope = typeof agentStopScopeValidator.type;

export { agentStopReasonValidator, type AgentStopReason };

export const agentStopStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed')
);
export type AgentStopStatus = typeof agentStopStatusValidator.type;

export const agentStopTargetStatusValidator = v.union(
  v.literal('pending'), v.literal('processing'), v.literal('completed'), v.literal('failed')
);
export type AgentStopTargetStatus = typeof agentStopTargetStatusValidator.type;

export function normalizeAgentStopRole(role: string): string {
  return role.trim().toLowerCase();
}
export function agentStopScopeKey(scope: AgentStopScope): string {
  return scope.kind === 'chatroom' ? 'chatroom' : `agent:${normalizeAgentStopRole(scope.role)}`;
}
export function buildAgentStopTargetKey(args: {
  machineId: string;
  role: string;
  pid: number;
}): string {
  return `${args.machineId}:${normalizeAgentStopRole(args.role)}:${args.pid}`;
}
export function buildAgentStopRevisionKey(args: {
  stopCommandId: string;
  targetKey: string;
}): string {
  return `${args.stopCommandId}:${args.targetKey}`;
}
