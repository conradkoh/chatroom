import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import {
  applyRoleToSummary,
  deriveAgentOperationalState,
  deriveAgentRoleViewState,
  deriveRoleOperationalState,
  removeRoleFromSummary,
  type RoleConfigSnapshot,
  normalizeOperationalSummary,
  operationalSummariesEqual,
  type ChatroomOperationalSummary,
} from './derive-agent-operational-state';
import { deriveRoleStopState } from './derive-agent-stop-state';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import {
  buildTeamRoleKey,
  filterTeamAgentConfigsForTeam,
} from '../../../../convex/utils/teamRoleKey';

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

export async function insertEmptyOperationalSummaryForRoom(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; ownerId: Id<'users'>; teamId: string }
): Promise<void> {
  const existing = await summaryFor(ctx, args.chatroomId);
  if (existing) {
    if (existing.ownerId !== args.ownerId)
      await ctx.db.patch('chatroom_agentOperationalSummary', existing._id, {
        ownerId: args.ownerId,
      });
    return;
  }
  await ctx.db.insert('chatroom_agentOperationalSummary', {
    chatroomId: args.chatroomId,
    ownerId: args.ownerId,
    teamId: args.teamId,
    remoteConfigCount: 0,
    agentStatus: 'none',
    runningRoles: [],
    aliveRoles: [],
    runningAgents: [],
    projectedAt: Date.now(),
  });
}

type SummaryWriteInput = ChatroomOperationalSummary & {
  chatroomId: Id<'chatroom_rooms'>;
  ownerId: Id<'users'>;
};

export async function writeOperationalSummary(
  ctx: MutationCtx,
  input: SummaryWriteInput
): Promise<void> {
  const normalized = normalizeOperationalSummary(input);
  const existing = await summaryFor(ctx, input.chatroomId);
  const comparable = existing && {
    teamId: existing.teamId,
    agentStatus: existing.agentStatus,
    runningRoles: existing.runningRoles,
    aliveRoles: existing.aliveRoles,
    runningAgents: existing.runningAgents,
    remoteConfigCount: existing.remoteConfigCount,
  };
  if (
    existing &&
    existing.ownerId === input.ownerId &&
    comparable &&
    operationalSummariesEqual(comparable, normalized)
  )
    return;
  const fields = { ownerId: input.ownerId, ...normalized, projectedAt: Date.now() };
  if (existing) await ctx.db.patch('chatroom_agentOperationalSummary', existing._id, fields);
  else
    await ctx.db.insert('chatroom_agentOperationalSummary', {
      chatroomId: input.chatroomId,
      ...fields,
    });
}

/** HOT PATH: project one current-team remote role without scanning the chatroom. */
export async function projectAgentOperationalStatusForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  revisionKey?: string,
  opts?: {
    config?: Doc<'chatroom_teamAgentConfigs'>;
    isNewConfig?: boolean;
    lastStatus?: string | null;
  }
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!room?.teamId) return;
  const teamId = room.teamId;
  const config =
    (await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, teamId, role))
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
  const stop = await deriveRoleStopState(ctx, chatroomId, roleKey, {
    isAlive: projection.isAlive,
    desiredState: config.desiredState,
  });
  const acceptsTasks =
    config.enabled !== false &&
    config.desiredState === 'running' &&
    config.circuitState !== 'open' &&
    !['pending', 'processing'].includes(stop.stopState ?? '');
  const fields = {
    chatroomId,
    role: roleKey,
    teamId: room.teamId,
    machineId: projection.machineId,
    operationalState: projection.operationalState,
    isAlive: projection.isAlive,
    isRunning: projection.isRunning,
    daemonConnected: projection.daemonConnected,
    viewState:
      isEphemeralAgentRole(roleKey) && acceptsTasks && !projection.isAlive
        ? ('idle' as const)
        : deriveAgentRoleViewState(
            snapshot(config, room.teamId),
            projection.daemonConnected,
            opts?.lastStatus
          ),
    acceptsTasks,
    projectedAt,
    revisionKey: key,
    ...stop,
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
    existing.viewState !== fields.viewState ||
    existing.machineId !== fields.machineId ||
    existing.teamId !== fields.teamId ||
    existing.stopState !== fields.stopState ||
    existing.activeStopCommandId !== fields.activeStopCommandId ||
    existing.acceptsTasks !== fields.acceptsTasks
  ) {
    if (existing) await ctx.db.patch('chatroom_agentRoleOperationalStatus', existing._id, fields);
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
    isNewConfig: !existing,
  });
  await writeOperationalSummary(ctx, { ...next, chatroomId, ownerId: room.ownerId });
}

export async function projectAgentStopStateForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (!room?.teamId) return;
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, room.teamId!, role))
    )
    .first();
  const row = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom_role', (q) =>
      q.eq('chatroomId', chatroomId).eq('role', role.toLowerCase())
    )
    .first();
  if (!config || !row) return;
  const stop = await deriveRoleStopState(ctx, chatroomId, role, {
    isAlive: config.spawnedAgentPid != null,
    desiredState: config.desiredState,
  });
  await ctx.db.patch('chatroom_agentRoleOperationalStatus', row._id, stop);
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
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (summary && room)
    await writeOperationalSummary(ctx, {
      ...removeRoleFromSummary(summary, role),
      chatroomId,
      ownerId: room.ownerId,
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
    {
      role: string;
      machineId?: string;
      isAlive: boolean;
      isRunning: boolean;
      daemonConnected: boolean;
      teamId: string;
      operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
      viewState: 'running' | 'stopped' | 'starting' | 'circuit_open';
    }[]
  >();
  for (const config of configs) {
    const room = await ctx.db.get('chatroom_rooms', config.chatroomId);
    const participants = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', config.chatroomId))
      .collect();
    const lastStatus = participants.find(
      (p) => p.role.toLowerCase() === config.role.toLowerCase()
    )?.lastStatus;
    const viewState = deriveAgentRoleViewState(
      {
        desiredState: config.desiredState,
        circuitState: config.circuitState,
        spawnedAgentPid: config.spawnedAgentPid,
      },
      daemonConnected,
      lastStatus
    );
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
        row.isRunning !== (row.isAlive && daemonConnected) ||
        row.viewState !== viewState)
    ) {
      await ctx.db.patch('chatroom_agentRoleOperationalStatus', row._id, {
        daemonConnected,
        isRunning: row.isAlive && daemonConnected,
        viewState,
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
        viewState,
      });
      changed.set(config.chatroomId, projections);
    }
  }
  for (const [chatroomId, projections] of changed) {
    const summary = await summaryFor(ctx, chatroomId);
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (summary && room) {
      let next = {
        teamId: summary.teamId,
        agentStatus: summary.agentStatus,
        runningRoles: summary.runningRoles,
        aliveRoles: summary.aliveRoles,
        runningAgents: summary.runningAgents,
        remoteConfigCount: summary.remoteConfigCount,
      };
      for (const projection of projections)
        next = applyRoleToSummary(next, projection, { isNewConfig: false });
      await writeOperationalSummary(ctx, { ...next, chatroomId, ownerId: room.ownerId });
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
  const teamId = room.teamId;
  const all = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const configs = filterTeamAgentConfigsForTeam(all, chatroomId, teamId).filter(
    (c) => c.machineId != null
  );
  const statuses = new Map<string, boolean>();
  for (const c of configs) {
    if (c.machineId) statuses.set(c.machineId, await machineConnected(ctx, c.machineId));
  }
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p.lastStatus]));
  const derived = deriveAgentOperationalState({
    teamId,
    configs: configs.map((c) => snapshot(c, teamId)),
    daemonConnectedByMachineId: statuses,
  });
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  for (const p of derived.roles)
    await projectAgentOperationalStatusForRole(ctx, chatroomId, p.role, key, {
      config: configs.find((c) => c.role.toLowerCase() === p.role.toLowerCase()),
      lastStatus: participantByRole.get(p.role.toLowerCase()),
    });
  await writeOperationalSummary(ctx, { ...derived.summary, chatroomId, ownerId: room.ownerId });
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
