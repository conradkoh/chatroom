import { isEphemeralAgentRole, normalizeAgentRole } from '@workspace/shared/domain/agent-role';

import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentStopScope } from '../../entities/agent-stop-command';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { getTeamStructure } from '../../entities/team-presets';

/** Clear ephemeral role presence after on-demand work finishes without a tracked PID. */
// fallow-ignore-next-line complexity
export async function releaseEphemeralAgentRole(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<void> {
  const role = normalizeAgentRole(args.role);
  if (!isEphemeralAgentRole(role)) return;

  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  const teamId = room?.teamId;
  if (teamId) {
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) =>
        q.eq('teamRoleKey', buildTeamRoleKey(args.chatroomId, teamId, role))
      )
      .first();
    if (config && config.desiredState !== 'stopped') {
      await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
        desiredState: 'stopped',
        updatedAt: Date.now(),
      });
    }
  }

  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', args.chatroomId).eq('role', role))
    .first();

  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAction: PARTICIPANT_EXITED_ACTION,
      lastInFlightTaskId: undefined,
    });
    await transitionAgentStatus(ctx, args.chatroomId, role, 'agent.exited');
    return;
  }

  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId: args.chatroomId,
    role,
    event: { status: 'offline' },
  });
}

// fallow-ignore-next-line complexity
async function listEphemeralRolesInChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<string[]> {
  const roles = new Set<string>();
  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  if (room?.teamId) {
    const structure = getTeamStructure({
      teamId: room.teamId,
      teamName: room.teamName,
      persistedRoles: room.teamRoles,
      persistedEntryPoint: room.teamEntryPoint,
    });
    for (const { role, lifecycle } of structure.roles) {
      if (lifecycle === 'ephemeral') roles.add(normalizeAgentRole(role));
    }
  }

  const [participants, statusRows] = await Promise.all([
    ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect(),
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect(),
  ]);
  for (const participant of participants) {
    if (isEphemeralAgentRole(participant.role)) roles.add(normalizeAgentRole(participant.role));
  }
  for (const row of statusRows) {
    if (row.roleKind === 'ephemeral' || isEphemeralAgentRole(row.role)) {
      roles.add(normalizeAgentRole(row.role));
    }
  }
  return [...roles];
}

async function ephemeralRolesForStopScope(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  scope: AgentStopScope
): Promise<string[]> {
  if (scope.kind === 'agent') {
    const role = normalizeAgentRole(scope.role);
    return isEphemeralAgentRole(role) ? [role] : [];
  }
  if (scope.kind !== 'chatroom') return [];
  return listEphemeralRolesInChatroom(ctx, chatroomId);
}

// fallow-ignore-next-line complexity
async function machineIdForEphemeralRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<string | undefined> {
  const participant = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
    .first();
  if (participant?.machineId) return participant.machineId;

  const room = await ctx.db.get('chatroom_rooms', chatroomId);
  const teamId = room?.teamId;
  if (!teamId) return undefined;
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) =>
      q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, teamId, role))
    )
    .first();
  return config?.machineId ?? undefined;
}

/** Machines that should receive scoped stop commands for ephemeral daemon work without a PID. */
// fallow-ignore-next-line complexity
export async function collectEphemeralStopMachineIds(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  scope: AgentStopScope
): Promise<string[]> {
  const machineIds = new Set<string>();
  const roles = await ephemeralRolesForStopScope(ctx, chatroomId, scope);
  for (const role of roles) {
    const machineId = await machineIdForEphemeralRole(ctx, chatroomId, role);
    if (machineId) machineIds.add(machineId);
  }

  if (scope.kind === 'chatroom' || (scope.kind === 'agent' && isEphemeralAgentRole(scope.role))) {
    // fallow-ignore-next-line code-duplication
    const [pending, running] = await Promise.all([
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'pending')
        )
        .collect(),
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('status', 'running')
        )
        .collect(),
    ]);
    for (const job of [...pending, ...running]) {
      if (job.machineId) machineIds.add(job.machineId);
    }
  }

  return [...machineIds];
}

/** Converge ephemeral role status when stop has no PID-backed targets for that role. */
export async function releaseEphemeralAgentRolesWithoutStopTargets(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    scope: AgentStopScope;
    rolesWithStopTargets: ReadonlySet<string>;
  }
): Promise<void> {
  const roles = await ephemeralRolesForStopScope(ctx, args.chatroomId, args.scope);
  for (const role of roles) {
    if (args.rolesWithStopTargets.has(role)) continue;
    await releaseEphemeralAgentRole(ctx, { chatroomId: args.chatroomId, role });
  }
}
