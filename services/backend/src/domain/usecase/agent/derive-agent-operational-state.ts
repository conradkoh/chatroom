import { isAgentAlive } from './is-agent-alive';
export type OperationalState = 'running' | 'stopped' | 'starting' | 'circuit_open';
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
export type ChatroomOperationalSummary = {
  teamId: string;
  agentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  aliveRoles: string[];
  runningAgents: Array<{ role: string; machineId: string }>;
  remoteConfigCount: number;
};
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
    runningAgents: running
      .filter((p) => p.machineId)
      .map((p) => ({ role: p.role, machineId: p.machineId! })),
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
  void options;
  const role = projection.role.toLowerCase();
  const withoutRole = removeRoleFromSummary(summary, role);
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
  const remoteConfigCount = withoutRole.remoteConfigCount + 1;
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
  const key = role.toLowerCase();
  return {
    ...summary,
    runningRoles: summary.runningRoles.filter((item) => item.toLowerCase() !== key),
    aliveRoles: summary.aliveRoles.filter((item) => item.toLowerCase() !== key),
    runningAgents: summary.runningAgents.filter((item) => item.role.toLowerCase() !== key),
    remoteConfigCount: Math.max(0, summary.remoteConfigCount - 1),
    agentStatus: recomputeAgentStatus({
      runningRoles: summary.runningRoles.filter((item) => item.toLowerCase() !== key),
      remoteConfigCount: Math.max(0, summary.remoteConfigCount - 1),
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
