import { isAgentAlive } from './is-agent-alive';

export type OperationalState = 'running' | 'stopped' | 'starting' | 'circuit_open';
export const IN_FLIGHT_START_STATUSES = new Set([
  'agent.requestStart',
  'agent.restart',
  'agent.restartPhase',
]);
export type RoleConfigSnapshot = {
  role: string;
  teamId: string;
  machineId?: string;
  desiredState?: 'running' | 'stopped';
  circuitState?: 'closed' | 'open' | 'half-open';
  spawnedAgentPid?: number | null;
};
export type RoleOperationalProjection = RoleConfigSnapshot & {
  operationalState: OperationalState;
  isAlive: boolean;
  isRunning: boolean;
  daemonConnected: boolean;
};
/** UI-facing state: daemon-gated running plus in-flight start inference. */
export function deriveAgentRoleViewState(
  config: Pick<RoleConfigSnapshot, 'desiredState' | 'circuitState' | 'spawnedAgentPid'>,
  daemonConnected: boolean,
  lastStatus?: string | null
): OperationalState {
  if (config.circuitState === 'open') return 'circuit_open';
  if (config.spawnedAgentPid != null && daemonConnected) return 'running';
  if (config.desiredState !== 'running') return 'stopped';
  if (daemonConnected && lastStatus && IN_FLIGHT_START_STATUSES.has(lastStatus)) return 'starting';
  return 'stopped';
}
export type ChatroomOperationalSummary = {
  teamId: string;
  agentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  aliveRoles: string[];
  runningAgents: { role: string; machineId: string }[];
  remoteConfigCount: number;
};

export type NormalizedOperationalSummary = ChatroomOperationalSummary;

export function normalizeOperationalSummary(
  summary: ChatroomOperationalSummary
): NormalizedOperationalSummary {
  const dedupeSort = (roles: string[]) => [...new Set(roles.map((r) => r.toLowerCase()))].sort();
  const runningAgents = [...summary.runningAgents]
    .map((a) => ({ role: a.role.toLowerCase(), machineId: a.machineId }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.machineId.localeCompare(b.machineId));
  return {
    ...summary,
    runningRoles: dedupeSort(summary.runningRoles),
    aliveRoles: dedupeSort(summary.aliveRoles),
    runningAgents,
  };
}

export function operationalSummariesEqual(
  a: ChatroomOperationalSummary,
  b: ChatroomOperationalSummary
): boolean {
  const na = normalizeOperationalSummary(a);
  const nb = normalizeOperationalSummary(b);
  return JSON.stringify(na) === JSON.stringify(nb);
}
export function deriveRoleOperationalState(
  config: RoleConfigSnapshot,
  daemonConnected: boolean
): RoleOperationalProjection {
  let operationalState: OperationalState = 'stopped';
  if (config.circuitState === 'open') operationalState = 'circuit_open';
  else if (config.desiredState === 'running')
    operationalState = config.spawnedAgentPid != null ? 'running' : 'starting';
  const isAlive = isAgentAlive(config.spawnedAgentPid);
  return {
    ...config,
    operationalState,
    isAlive,
    isRunning: isAlive && daemonConnected,
    daemonConnected,
  };
}
export function deriveChatroomOperationalSummary(
  teamId: string,
  roles: RoleOperationalProjection[],
  hasAnyConfig: boolean
): ChatroomOperationalSummary {
  const running = roles.filter((p) => p.isRunning);
  return {
    teamId,
    agentStatus: !hasAnyConfig ? 'none' : running.length ? 'running' : 'stopped',
    runningRoles: running.map((p) => p.role),
    aliveRoles: roles.filter((p) => p.isAlive).map((p) => p.role),
    runningAgents: running.flatMap((p) =>
      p.machineId ? [{ role: p.role, machineId: p.machineId }] : []
    ),
    remoteConfigCount: hasAnyConfig ? roles.length : 0,
  };
}

export function recomputeAgentStatus(
  summary: Pick<ChatroomOperationalSummary, 'runningRoles'> & { remoteConfigCount: number }
): ChatroomOperationalSummary['agentStatus'] {
  if (summary.remoteConfigCount === 0) return 'none';
  return summary.runningRoles.length > 0 ? 'running' : 'stopped';
}

export function applyRoleToSummary(
  summary: ChatroomOperationalSummary,
  projection: RoleOperationalProjection,
  options?: { isNewConfig?: boolean }
): ChatroomOperationalSummary {
  const role = projection.role.toLowerCase();
  const withoutRole = stripRoleFromSummaryArrays(summary, role);
  const runningRoles = projection.isRunning
    ? [...withoutRole.runningRoles, role]
    : withoutRole.runningRoles;
  const aliveRoles = projection.isAlive
    ? [...withoutRole.aliveRoles, role]
    : withoutRole.aliveRoles;
  const runningAgents =
    projection.isRunning && projection.machineId
      ? [...withoutRole.runningAgents, { role, machineId: projection.machineId }]
      : withoutRole.runningAgents;
  const remoteConfigCount = options?.isNewConfig
    ? withoutRole.remoteConfigCount + 1
    : withoutRole.remoteConfigCount;
  const next = {
    ...withoutRole,
    teamId: projection.teamId,
    runningRoles,
    aliveRoles,
    runningAgents,
    remoteConfigCount,
  };
  return { ...next, agentStatus: recomputeAgentStatus(next) };
}

export function removeRoleFromSummary(
  summary: ChatroomOperationalSummary,
  role: string
): ChatroomOperationalSummary {
  const stripped = stripRoleFromSummaryArrays(summary, role);
  const remoteConfigCount = Math.max(0, stripped.remoteConfigCount - 1);
  return {
    ...stripped,
    remoteConfigCount,
    agentStatus: recomputeAgentStatus({
      runningRoles: stripped.runningRoles,
      remoteConfigCount,
    }),
  };
}

/** Remove a role from summary arrays without changing the config count. */
export function stripRoleFromSummaryArrays(
  summary: ChatroomOperationalSummary,
  role: string
): ChatroomOperationalSummary {
  const key = role.toLowerCase();
  const runningRoles = summary.runningRoles.filter((item) => item.toLowerCase() !== key);
  const aliveRoles = summary.aliveRoles.filter((item) => item.toLowerCase() !== key);
  const runningAgents = summary.runningAgents.filter((item) => item.role.toLowerCase() !== key);
  return {
    ...summary,
    runningRoles,
    aliveRoles,
    runningAgents,
    agentStatus: recomputeAgentStatus({
      runningRoles,
      remoteConfigCount: summary.remoteConfigCount,
    }),
  };
}
export function deriveAgentOperationalState(args: {
  teamId: string;
  configs: RoleConfigSnapshot[];
  daemonConnectedByMachineId: Map<string, boolean>;
}) {
  const roles = args.configs.map((c) =>
    deriveRoleOperationalState(
      c,
      c.machineId ? (args.daemonConnectedByMachineId.get(c.machineId) ?? false) : false
    )
  );
  return {
    roles,
    summary: deriveChatroomOperationalSummary(args.teamId, roles, args.configs.length > 0),
  };
}
