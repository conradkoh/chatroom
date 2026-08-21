export type AgentLifecycleFact =
  | {
      kind: 'spawned';
      chatroomId: string;
      role: string;
      pid: number;
      model?: string;
      reason?: string;
      harnessSessionId?: string;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'exited';
      chatroomId: string;
      role: string;
      pid: number;
      stopReason?: string;
      stopSignal?: string;
      exitCode?: number;
      signal?: string;
      agentHarness?: string;
      revisionKey: string;
      emittedAt: number;
    }
  | { kind: 'cleared_all_pids'; revisionKey: string; emittedAt: number };

export function agentLifecycleDeliveryKey(machineId: string, fact: AgentLifecycleFact): string {
  if (fact.kind === 'cleared_all_pids') return `${machineId}:__machine__`;
  return `${machineId}:${fact.chatroomId}:${fact.role.toLowerCase()}`;
}

export function buildAgentLifecycleRevisionKey(
  prefix: string,
  parts: Record<string, string | number | undefined>
): string {
  return `${prefix}:${Object.entries(parts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(':')}`;
}
