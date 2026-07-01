/**
 * Centralized team agent config writes that always refresh the assigned-task
 * snapshot projection for the affected machine or chatroom.
 */

import {
  projectAssignedTaskSnapshotsForChatroom,
  projectAssignedTaskSnapshotsForMachine,
} from './machine-assigned-task-snapshot-sync';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { deleteStaleTeamAgentConfigs } from '../../../../convex/utils/teamRoleKey';

type TeamAgentConfigPatch = Partial<
  Omit<Doc<'chatroom_teamAgentConfigs'>, '_id' | '_creationTime'>
>;

type TeamAgentConfigUpsertFields = Omit<
  Doc<'chatroom_teamAgentConfigs'>,
  '_id' | '_creationTime' | 'teamRoleKey' | 'createdAt'
>;

export type PatchTeamAgentConfigOptions = {
  /** Rebuild projection for one machine (default) or all machines in the chatroom. */
  projectScope?: 'chatroom' | 'machine';
  /** Patch only — caller will project in batch (e.g. clearAllSpawnedPids). */
  skipProject?: boolean;
};

export type UpsertTeamAgentConfigResult = {
  configId: Id<'chatroom_teamAgentConfigs'>;
  previousMachineId?: string;
  wasInsert: boolean;
};

/**
 * Patch a team agent config and refresh daemon snapshot projection.
 * Use this instead of raw `ctx.db.patch('chatroom_teamAgentConfigs', …)` +
 * manual `syncChatroomAssignedTaskSnapshots`.
 */
// fallow-ignore-next-line complexity
export async function patchTeamAgentConfig(
  ctx: MutationCtx,
  configId: Id<'chatroom_teamAgentConfigs'>,
  patch: TeamAgentConfigPatch,
  options?: PatchTeamAgentConfigOptions
): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  const existing = await ctx.db.get('chatroom_teamAgentConfigs', configId);
  if (!existing) {
    return null;
  }

  const now = Date.now();
  await ctx.db.patch('chatroom_teamAgentConfigs', configId, {
    ...patch,
    updatedAt: patch.updatedAt ?? now,
  });

  if (options?.skipProject) {
    return existing;
  }

  await projectTeamAgentConfigPatch(ctx, existing, options?.projectScope);
  return existing;
}

/**
 * Insert or patch a team agent config by teamRoleKey (no projection).
 * Call `projectAfterTeamConfigRegistration` or `projectAssignedTaskSnapshotsForMachines` after.
 */
export async function upsertTeamAgentConfigByTeamRoleKey(
  ctx: MutationCtx,
  args: {
    teamRoleKey: string;
    fields: TeamAgentConfigUpsertFields;
    createdAt?: number;
  }
): Promise<UpsertTeamAgentConfigResult> {
  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', args.teamRoleKey))
    .first();

  const now = Date.now();
  const fields = {
    ...args.fields,
    teamRoleKey: args.teamRoleKey,
    updatedAt: args.fields.updatedAt ?? now,
  };

  if (existing) {
    await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, fields);
    return {
      configId: existing._id,
      previousMachineId: existing.machineId,
      wasInsert: false,
    };
  }

  await deleteStaleTeamAgentConfigs(ctx, args.teamRoleKey);
  const configId = await ctx.db.insert('chatroom_teamAgentConfigs', {
    ...fields,
    createdAt: args.createdAt ?? now,
  });
  return { configId, wasInsert: true };
}

/** Rebuild projection after saveTeamAgentConfig / remote registration. */
export async function projectAfterTeamConfigRegistration(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    machineId?: string;
    previousMachineId?: string;
  }
): Promise<void> {
  await projectAssignedTaskSnapshotsForChatroom(ctx, args.chatroomId);
  if (args.previousMachineId && args.previousMachineId !== args.machineId) {
    await projectAssignedTaskSnapshotsForMachine(ctx, args.previousMachineId);
  }
}

/** Rebuild projection for each machine once (e.g. team switch teardown). */
export async function projectAssignedTaskSnapshotsForMachines(
  ctx: MutationCtx,
  machineIds: Iterable<string>
): Promise<void> {
  const seen = new Set<string>();
  for (const machineId of machineIds) {
    if (seen.has(machineId)) {
      continue;
    }
    seen.add(machineId);
    await projectAssignedTaskSnapshotsForMachine(ctx, machineId);
  }
}

async function projectTeamAgentConfigPatch(
  ctx: MutationCtx,
  existing: Doc<'chatroom_teamAgentConfigs'>,
  scope: PatchTeamAgentConfigOptions['projectScope'] = 'machine'
): Promise<void> {
  if (scope === 'chatroom') {
    await projectAssignedTaskSnapshotsForChatroom(ctx, existing.chatroomId);
    return;
  }
  if (existing.machineId) {
    await projectAssignedTaskSnapshotsForMachine(ctx, existing.machineId);
    return;
  }
  await projectAssignedTaskSnapshotsForChatroom(ctx, existing.chatroomId);
}
