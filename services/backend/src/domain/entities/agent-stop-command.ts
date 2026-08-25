// fallow-ignore-file unused-file unused-export unused-type
import { v } from 'convex/values';

export const agentStopScopeValidator = v.union(
  v.object({ kind: v.literal('chatroom') }),
  v.object({ kind: v.literal('agent'), role: v.string() })
);
export type AgentStopScope = typeof agentStopScopeValidator.type;

export const agentStopReasonValidator = v.union(
  v.literal('user.stop'),
  v.literal('daemon.shutdown'),
  v.literal('team.switch'),
  v.literal('dedup'),
  v.literal('stale-config')
);
export type AgentStopReason = typeof agentStopReasonValidator.type;

export const agentStopStatusValidator = v.union(
  v.literal('pending'),
  v.literal('processing'),
  v.literal('completed'),
  v.literal('failed')
);
export type AgentStopStatus = typeof agentStopStatusValidator.type;

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
