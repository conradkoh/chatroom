import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import { ConvexError } from 'convex/values';

import {
  projectAfterTeamConfigRegistration,
  upsertTeamAgentConfigByTeamRoleKey,
} from './patch-team-agent-config';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentHarness } from '../../entities/agent';
import { getTeamRolesFromChatroom } from '../chatroom/get-team-roles';

export interface ConfigureTeamAgentRoleArgs {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  role: string;
  machineId: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
}

/**
 * Configuration-only save for a team agent role. Never starts the agent and
 * never overwrites an existing runtime lifecycle state: on an existing row,
 * `desiredState`, `enabled`, `lifecycleRevision`, `circuitState`, and
 * `createdAt` are preserved; only machine/harness/model/workingDir(+updatedAt)
 * change. A brand-new row is created `desiredState: 'stopped'` so saving
 * defaults can never launch an on-demand role.
 */
// fallow-ignore-next-line complexity
export async function configureTeamAgentRole(
  ctx: MutationCtx,
  args: ConfigureTeamAgentRoleArgs
): Promise<Doc<'chatroom_teamAgentConfigs'>> {
  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom) {
    throw new ConvexError({ code: 'CHATROOM_NOT_FOUND', message: 'Chatroom not found' });
  }
  if (chatroom.ownerId !== args.userId) {
    throw new ConvexError({ code: 'FORBIDDEN', message: 'Not authorized' });
  }
  if (!chatroom.teamId) {
    throw new ConvexError({
      code: 'CHATROOM_NO_TEAM_ID',
      message: 'Chatroom has no teamId',
    });
  }

  const { teamRoles } = getTeamRolesFromChatroom(chatroom);
  const structure = getTeamStructure({
    teamId: chatroom.teamId,
    ...(chatroom.teamName !== undefined ? { teamName: chatroom.teamName } : {}),
    persistedRoles: teamRoles,
    ...(chatroom.teamEntryPoint !== undefined
      ? { persistedEntryPoint: chatroom.teamEntryPoint }
      : {}),
  });
  const isMember = structure.roles.some((r) => r.role.toLowerCase() === args.role.toLowerCase());
  if (!isMember) {
    throw new ConvexError({
      code: 'INVALID_ROLE',
      message: `${args.role} is not a role in the current team`,
    });
  }

  if (!args.machineId.trim()) {
    throw new ConvexError({ code: 'INVALID_MACHINE', message: 'machineId must not be empty' });
  }
  if (!args.model.trim()) {
    throw new ConvexError({ code: 'INVALID_MODEL', message: 'model must not be empty' });
  }
  if (!args.workingDir.trim()) {
    throw new ConvexError({
      code: 'INVALID_WORKING_DIR',
      message: 'workingDir must not be empty',
    });
  }

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
    .first();
  if (!machine || machine.userId !== args.userId) {
    throw new ConvexError({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
  }

  const teamRoleKey = buildTeamRoleKey(args.chatroomId, chatroom.teamId, args.role);
  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  // Config-only save must never start an agent — new rows always default to stopped.
  const desiredState = existing?.desiredState ?? 'stopped';

  const { previousMachineId } = await upsertTeamAgentConfigByTeamRoleKey(ctx, {
    teamRoleKey,
    createdAt: existing?.createdAt ?? Date.now(),
    fields: {
      chatroomId: args.chatroomId,
      role: args.role,
      type: 'remote',
      machineId: args.machineId,
      agentHarness: args.agentHarness,
      model: args.model.trim(),
      workingDir: args.workingDir.trim(),
      enabled: existing?.enabled ?? true,
      desiredState,
      circuitState: existing?.circuitState ?? 'closed',
      lifecycleRevision: existing?.lifecycleRevision ?? 0,
      updatedAt: Date.now(),
    },
  });

  await projectAfterTeamConfigRegistration(ctx, {
    chatroomId: args.chatroomId,
    machineId: args.machineId,
    previousMachineId,
  });

  const saved = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();
  if (!saved) {
    throw new ConvexError({
      code: 'CONFIG_SYNC_FAILED',
      message: 'Failed to save team agent config',
    });
  }
  return saved;
}
