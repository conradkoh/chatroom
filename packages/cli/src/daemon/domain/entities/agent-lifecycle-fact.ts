// fallow-ignore-file code-duplication
export type AgentLifecycleFact =
  | {
      kind: 'activity';
      chatroomId: string;
      role: string;
      action: string;
      taskId?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'spawned';
      chatroomId: string;
      role: string;
      pid: number;
      model?: string | undefined;
      reason?: string | undefined;
      harnessSessionId?: string | undefined;
      revisionKey: string;
      emittedAt: number;
      lifecycleRevision?: number | undefined;
    }
  | {
      kind: 'exited';
      chatroomId: string;
      role: string;
      pid: number;
      stopReason?: string | undefined;
      stopSignal?: string | undefined;
      exitCode?: number | undefined;
      signal?: string | undefined;
      agentHarness?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | { kind: 'cleared_all_pids'; revisionKey: string; emittedAt: number };

/** Audit-log / retry payload for agent.exited — not valid as a lifecycle fact. */
export type AgentExitAuditArgs = {
  sessionId: string;
  machineId: string;
  chatroomId: string;
  role: string;
  pid: number;
  stopReason?: string | undefined;
  stopSignal?: string | undefined;
  exitCode?: number | undefined;
  signal?: string | undefined;
  agentHarness?: string | undefined;
};

export type ExitedLifecycleFact = Extract<AgentLifecycleFact, { kind: 'exited' }>;

export function buildExitedLifecycleFact(
  auditArgs: AgentExitAuditArgs,
  emittedAt: number
): ExitedLifecycleFact {
  const { sessionId: _sessionId, machineId: _machineId, ...fields } = auditArgs;
  return {
    kind: 'exited',
    ...fields,
    revisionKey: buildAgentLifecycleRevisionKey('exited', {
      chatroomId: auditArgs.chatroomId,
      role: auditArgs.role,
      pid: auditArgs.pid,
      emittedAt,
    }),
    emittedAt,
  };
}

/** Strip audit-only fields accidentally persisted on lifecycle facts (legacy outbox rows). */
// fallow-ignore-next-line complexity
export function normalizeAgentLifecycleFact(raw: unknown): AgentLifecycleFact {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid agent lifecycle fact');
  }
  const value = raw as Record<string, unknown>;
  const { sessionId: _sessionId, machineId: _machineId, ...rest } = value;
  const kind = rest.kind;
  if (kind === 'cleared_all_pids') {
    return {
      kind: 'cleared_all_pids',
      revisionKey: String(rest.revisionKey),
      emittedAt: Number(rest.emittedAt),
    };
  }
  if (kind === 'spawned' || kind === 'exited' || kind === 'activity') {
    return rest as AgentLifecycleFact;
  }
  throw new Error(`Unknown agent lifecycle fact kind: ${String(kind)}`);
}

export function buildActivityLifecycleFact(params: {
  chatroomId: string; role: string; action: string; taskId?: string | undefined; emittedAt?: number | undefined;
}): Extract<AgentLifecycleFact, { kind: 'activity' }> {
  const emittedAt = params.emittedAt ?? Date.now();
  return { kind: 'activity', chatroomId: params.chatroomId, role: params.role, action: params.action,
    ...(params.taskId ? { taskId: params.taskId } : {}),
    revisionKey: buildAgentLifecycleRevisionKey('activity', { ...params, emittedAt }), emittedAt };
}

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
