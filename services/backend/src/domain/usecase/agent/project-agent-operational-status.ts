import {
  deriveAgentOperationalState,
  type RoleConfigSnapshot,
} from './derive-agent-operational-state';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';

async function connected(ctx: MutationCtx, ids: Iterable<string>) {
  const result = new Map<string, boolean>();
  for (const id of ids)
    result.set(
      id,
      (
        await ctx.db
          .query('chatroom_machineStatus')
          .withIndex('by_machineId', (q) => q.eq('machineId', id))
          .first()
      )?.status === 'online'
    );
  return result;
}
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
export async function projectAgentOperationalStatusForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  revisionKey?: string
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
  const { roles, summary } = deriveAgentOperationalState({
    teamId: room.teamId,
    configs: configs.map((c) => snapshot(c, room.teamId!)),
    daemonConnectedByMachineId: await connected(
      ctx,
      configs.map((c) => c.machineId!)
    ),
  });
  const projectedAt = Date.now();
  const key = revisionKey ?? `operational:${chatroomId}:${projectedAt}`;
  for (const p of roles) {
    const role = p.role.toLowerCase();
    const fields = {
      chatroomId,
      role,
      teamId: p.teamId,
      machineId: p.machineId,
      operationalState: p.operationalState,
      isAlive: p.isAlive,
      isRunning: p.isRunning,
      daemonConnected: p.daemonConnected,
      projectedAt,
      revisionKey: key,
    };
    const existing = await ctx.db
      .query('chatroom_agentRoleOperationalStatus')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first();
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert('chatroom_agentRoleOperationalStatus', fields);
  }
  const derivedRoles = new Set(roles.map((p) => p.role.toLowerCase()));
  const existingRoleRows = await ctx.db
    .query('chatroom_agentRoleOperationalStatus')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  for (const row of existingRoleRows) {
    if (!derivedRoles.has(row.role)) {
      await ctx.db.delete('chatroom_agentRoleOperationalStatus', row._id);
    }
  }
  const existingSummary = await ctx.db
    .query('chatroom_agentOperationalSummary')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();
  const fields = { chatroomId, ...summary, projectedAt };
  if (existingSummary) await ctx.db.patch(existingSummary._id, fields);
  else await ctx.db.insert('chatroom_agentOperationalSummary', fields);
}
export async function projectAgentOperationalStatusForMachine(
  ctx: MutationCtx,
  machineId: string,
  revisionKey?: string
): Promise<void> {
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  for (const id of [...new Set(configs.map((c) => c.chatroomId))])
    await projectAgentOperationalStatusForChatroom(ctx, id, revisionKey);
}
