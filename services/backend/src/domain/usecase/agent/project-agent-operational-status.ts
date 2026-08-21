import {
  applyRoleToSummary,
  deriveAgentOperationalState,
  deriveRoleOperationalState,
  removeRoleFromSummary,
  type RoleConfigSnapshot,
} from './derive-agent-operational-state';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';

type RebuildOptions = { pruneStale?: boolean };

function snapshot(config: Doc<'chatroom_teamAgentConfigs'>, teamId: string): RoleConfigSnapshot {
  return {
    role: config.role,
    teamId,
    machineId: config.machineId,
    desiredState: config.desiredState,
    circuitState: config.circuitState,
    spawnedAgentPid: config.spawnedAgentPid,
  };
}

async function machineConnected(ctx: MutationCtx, machineId: string): Promise<boolean> {
  const status = await ctx.db
    .query('chatroom_machineStatus')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  return status?.status === 'online';
}

async function summaryFor(ctx: MutationCtx, chatroomId: Id<'chatroom_rooms'>) {
  return ctx.db
    .query('chatroom_agentOperationalSummary')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
}

/** HOT PATH: project one current-team remote role without scanning the chatroom. */
export async function projectAgentOperationalStatusForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  revisionKey?: string,
  opts?: { config?: Doc<'chatroom_teamAgentConfigs'>; isNewConfig?: boolean }
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!room?.teamId) return;
  const config =
    (await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq(
          'teamRoleKey',
          `chatroom_${chatroomId}#team_${room.teamId!.toLowerCase()}#role_${role.toLowerCase()}`
        )
      )
      .first()) ?? opts?.config;
  if (
    !config ||
    !config.machineId ||
    !filterTeamAgentConfigsForTeam([config], chatroomId, room.teamId).length
  )
    return;
  const projection = deriveRoleOperationalState(
    snapshot(config, room.teamId),
    await machineConnected(ctx, config.machineId)
  );
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  const roleKey = role.toLowerCase();
  const fields = {
    chatroomId,
    role: roleKey,
    teamId: room.teamId,
    machineId: projection.machineId,
    operationalState: projection.operationalState,
    isAlive: projection.isAlive,
    isRunning: projection.isRunning,
    daemonConnected: projection.daemonConnected,
    projectedAt,
    revisionKey: key,
  };
  const existing = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', roleKey))
    .first();
  if (
    !existing ||
    existing.operationalState !== fields.operationalState ||
    existing.isAlive !== fields.isAlive ||
    existing.isRunning !== fields.isRunning ||
    existing.daemonConnected !== fields.daemonConnected ||
    existing.machineId !== fields.machineId ||
    existing.teamId !== fields.teamId
  ) {
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert('chatroom_agentRoleOperationalStatus', fields);
  }
  const summary = await summaryFor(ctx, chatroomId);
  const base = summary ?? {
    chatroomId,
    teamId: room.teamId,
    agentStatus: 'none' as const,
    runningRoles: [],
    aliveRoles: [],
    runningAgents: [],
    remoteConfigCount: 0,
    projectedAt,
  };
  const next = applyRoleToSummary(base, projection, {
    isNewConfig: !existing || opts?.isNewConfig,
  });
  await ctx.db.patch(
    summary?._id ??
      (await ctx.db.insert('chatroom_agentOperationalSummary', { ...base, ...next, projectedAt })),
    { ...next, projectedAt }
  );
}

/** HOT PATH: remove one role and update its summary without scanning configs. */
export async function projectAgentOperationalStatusForRoleRemoved(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  const row = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', role.toLowerCase())
    )
    .first();
  if (row) await ctx.db.delete('chatroom_agentRoleOperationalStatus', row._id);
  const summary = await summaryFor(ctx, chatroomId);
  if (summary)
    await ctx.db.patch(summary._id, {
      ...removeRoleFromSummary(summary, role),
      projectedAt: Date.now(),
    });
}

/** HOT PATH: patch connectivity for machine-bound role rows and summaries. */
export async function projectDaemonConnectivityForMachine(
  ctx: MutationCtx,
  machineId: string,
  daemonConnected: boolean
): Promise<void> {
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  const changed = new Map<
    Id<'chatroom_rooms'>,
    Array<{
      role: string;
      machineId?: string;
      isAlive: boolean;
      isRunning: boolean;
      daemonConnected: boolean;
      teamId: string;
      operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
    }>
  >();
  for (const config of configs) {
    const room = await ctx.db.get('chatroom_rooms', config.chatroomId);
    if (
      !room?.teamId ||
      !filterTeamAgentConfigsForTeam([config], config.chatroomId, room.teamId).length
    )
      continue;
    const row = await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom_role', (q) =>
        q.eq('chatroomId', config.chatroomId).eq('role', config.role.toLowerCase())
      )
      .first();
    if (
      row &&
      (row.daemonConnected !== daemonConnected ||
        row.isRunning !== (row.isAlive && daemonConnected))
    ) {
      await ctx.db.patch(row._id, {
        daemonConnected,
        isRunning: row.isAlive && daemonConnected,
        projectedAt: Date.now(),
      });
      const projections = changed.get(config.chatroomId) ?? [];
      projections.push({
        role: row.role,
        machineId: row.machineId,
        isAlive: row.isAlive,
        isRunning: row.isAlive && daemonConnected,
        daemonConnected,
        teamId: row.teamId,
        operationalState: row.operationalState,
      });
      changed.set(config.chatroomId, projections);
    }
  }
  for (const [chatroomId, projections] of changed) {
    const summary = await summaryFor(ctx, chatroomId);
    if (summary) {
      let next = {
        teamId: summary.teamId,
        agentStatus: summary.agentStatus,
        runningRoles: summary.runningRoles,
        aliveRoles: summary.aliveRoles,
        runningAgents: summary.runningAgents,
        remoteConfigCount: summary.remoteConfigCount,
      };
      for (const projection of projections) next = applyRoleToSummary(next, projection);
      await ctx.db.patch(summary._id, { ...next, projectedAt: Date.now() });
    }
  }
}

/** COLD PATH: rebuild all current-team remote role rows and optionally prune stale rows. */
export async function rebuildAgentOperationalStatusForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  revisionKey?: string,
  options?: RebuildOptions
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!room?.teamId) return;
  const all = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const configs = filterTeamAgentConfigsForTeam(all, chatroomId, room.teamId).filter(
    (c) => c.machineId != null
  );
  const statuses = new Map<string, boolean>();
  for (const c of configs) statuses.set(c.machineId!, await machineConnected(ctx, c.machineId!));
  const derived = deriveAgentOperationalState({
    teamId: room.teamId,
    configs: configs.map((c) => snapshot(c, room.teamId!)),
    daemonConnectedByMachineId: statuses,
  });
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  for (const p of derived.roles)
    await projectAgentOperationalStatusForRole(ctx, chatroomId, p.role, key, {
      config: configs.find((c) => c.role.toLowerCase() === p.role.toLowerCase()),
    });
  const summary = await summaryFor(ctx, chatroomId);
  if (summary) await ctx.db.patch(summary._id, { ...derived.summary, projectedAt });
  if (options?.pruneStale) {
    const keep = new Set(derived.roles.map((p) => p.role.toLowerCase()));
    const rows = await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    for (const row of rows)
      if (!keep.has(row.role)) await ctx.db.delete('chatroom_agentRoleOperationalStatus', row._id);
  }
}

export async function rebuildAgentOperationalStatusForMachine(
  ctx: MutationCtx,
  machineId: string,
  revisionKey?: string
): Promise<void> {
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  for (const id of [...new Set(configs.map((c) => c.chatroomId))])
    await rebuildAgentOperationalStatusForChatroom(ctx, id, revisionKey);
}

export const projectAgentOperationalStatusForChatroom = rebuildAgentOperationalStatusForChatroom;
export const projectAgentOperationalStatusForMachine = rebuildAgentOperationalStatusForMachine;
