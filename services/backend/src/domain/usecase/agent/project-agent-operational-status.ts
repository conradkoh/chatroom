// fallow-ignore-file code-duplication unused-export complexity
import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import {
  applyRoleToSummary,
  deriveAgentOperationalState,
  deriveAgentRoleViewState,
  deriveRoleOperationalState,
  type RoleConfigSnapshot,
  normalizeOperationalSummary,
  operationalSummariesEqual,
  type ChatroomOperationalSummary,
} from './derive-agent-operational-state';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { omitUndefined } from '../../../../convex/lib/omitUndefined';
import {
  buildTeamRoleKey,
  filterTeamAgentConfigsForTeam,
} from '../../../../convex/utils/teamRoleKey';

type RebuildOptions = { pruneStale?: boolean | undefined };

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
  const fields = omitUndefined({ ownerId: input.ownerId, ...normalized, projectedAt: Date.now() });
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
    config?: Doc<'chatroom_teamAgentConfigs'> | undefined;
    isNewConfig?: boolean | undefined;
    lastStatus?: string | null | undefined;
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
  const projection = deriveRoleOperationalState(snapshot(config, room.teamId));
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  const roleKey = role.toLowerCase();
  const acceptsTasks =
    config.enabled !== false && config.desiredState === 'running' && config.circuitState !== 'open';
  const fields = omitUndefined({
    chatroomId,
    role: roleKey,
    teamId: room.teamId,
    agentType: config.type,
    machineId: projection.machineId,
    workingDir: config.workingDir,
    operationalState: projection.operationalState,
    isAlive: projection.isAlive,
    isRunning: projection.isRunning,
    viewState:
      isEphemeralAgentRole(roleKey) && acceptsTasks && !projection.isAlive
        ? ('idle' as const)
        : opts?.lastStatus != null
          ? deriveAgentRoleViewState(snapshot(config, room.teamId), opts.lastStatus)
          : projection.operationalState,
    acceptsTasks,
    projectedAt,
    revisionKey: key,
  });
  const existing = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', roleKey))
    .first();
  if (
    !existing ||
    existing.operationalState !== fields.operationalState ||
    existing.isAlive !== fields.isAlive ||
    existing.isRunning !== fields.isRunning ||
    existing.viewState !== fields.viewState ||
    existing.machineId !== fields.machineId ||
    existing.workingDir !== fields.workingDir ||
    existing.teamId !== fields.teamId ||
    existing.acceptsTasks !== fields.acceptsTasks
  ) {
    if (existing) await ctx.db.patch('chatroom_agentRoleStatusReadModel', existing._id, fields);
    else
      await ctx.db.insert('chatroom_agentRoleStatusReadModel', {
        ...fields,
        roleKind: isEphemeralAgentRole(roleKey) ? 'ephemeral' : 'persistent',
        status: 'offline',
      });
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
  const derived = deriveAgentOperationalState({
    teamId,
    configs: configs.map((c) => snapshot(c, teamId)),
  });
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  for (const p of derived.roles)
    await projectAgentOperationalStatusForRole(ctx, chatroomId, p.role, key, {
      config: configs.find((c) => c.role.toLowerCase() === p.role.toLowerCase()),
    });
  await writeOperationalSummary(ctx, { ...derived.summary, chatroomId, ownerId: room.ownerId });
  if (options?.pruneStale) {
    const keep = new Set(derived.roles.map((p) => p.role.toLowerCase()));
    const rows = await ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    for (const row of rows)
      if (!keep.has(row.role)) await ctx.db.delete('chatroom_agentRoleStatusReadModel', row._id);
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
