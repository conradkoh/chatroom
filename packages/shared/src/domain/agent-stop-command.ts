export type AgentStopScope = { kind: 'chatroom' } | { kind: 'agent'; role: string };
export interface AgentStopTargetDescriptor {
  agentConfigId: string;
  chatroomId: string;
  machineId: string;
  role: string;
  pid: number;
  agentHarness: string;
  targetKey: string;
}
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
