// fallow-ignore-file complexity

/** Centralized team agent config writes and operational-state projection. */
import { writeWorkspaceTaskInboxEventsForRole } from './write-workspace-task-inbox-event';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { WorkspaceTaskInboxEventType } from '../../entities/chatroom-workspace-task-inbox';
import { deleteStaleTeamAgentConfigs } from '../agent/delete-stale-team-agent-configs';
import { projectAgentOperationalStatusForRole } from '../agent/project-agent-operational-status';

type AllowUndefinedForOptionalProperties<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? T[K] | undefined : T[K];
};

type TeamAgentConfigPatch = AllowUndefinedForOptionalProperties<
  Partial<Omit<Doc<'chatroom_teamAgentConfigs'>, '_id' | '_creationTime'>>
>;

type TeamAgentConfigUpsertFields = AllowUndefinedForOptionalProperties<
  Omit<Doc<'chatroom_teamAgentConfigs'>, '_id' | '_creationTime' | 'teamRoleKey' | 'createdAt'>
>;

export type PatchTeamAgentConfigOptions = {
  /** Rebuild projection for one machine (default) or all machines in the chatroom. */
  projectScope?: 'chatroom' | 'machine' | undefined;
  /** Patch only — caller will project in batch (e.g. clearAllSpawnedPids). */
  skipProject?: boolean | undefined;
};

export type UpsertTeamAgentConfigResult = {
  configId: Id<'chatroom_teamAgentConfigs'>;
  previousMachineId?: string | undefined;
  wasInsert: boolean;
};

/**
 * Patch a team agent config and refresh its operational-state projection.
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
  } as unknown as Partial<Doc<'chatroom_teamAgentConfigs'>>);

  if (options?.skipProject) {
    return existing;
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'machineId') ||
    Object.prototype.hasOwnProperty.call(patch, 'agentHarness') ||
    Object.prototype.hasOwnProperty.call(patch, 'model') ||
    Object.prototype.hasOwnProperty.call(patch, 'workingDir')
  ) {
    await writeWorkspaceTaskInboxEventsForRole(ctx, {
      chatroomId: existing.chatroomId,
      role: existing.role,
      eventType: WorkspaceTaskInboxEventType.TaskUpdated,
    });
  }

  await projectTeamAgentConfigPatch(ctx, existing, options?.projectScope);
  return existing;
}

/**
 * Insert or patch a team agent config by teamRoleKey.
 */
export async function upsertTeamAgentConfigByTeamRoleKey(
  ctx: MutationCtx,
  args: {
    teamRoleKey: string;
    fields: TeamAgentConfigUpsertFields;
    createdAt?: number | undefined;
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
    await ctx.db.patch(
      'chatroom_teamAgentConfigs',
      existing._id,
      fields as unknown as Partial<Doc<'chatroom_teamAgentConfigs'>>
    );
    return {
      configId: existing._id,
      previousMachineId: existing.machineId,
      wasInsert: false,
    };
  }

  await deleteStaleTeamAgentConfigs(ctx, args.teamRoleKey);
  const configId = await ctx.db.insert('chatroom_teamAgentConfigs', {
    ...fields,
    enabled: fields.enabled ?? true,
    lifecycleRevision: fields.lifecycleRevision ?? 0,
    createdAt: args.createdAt ?? now,
  } as unknown as Omit<Doc<'chatroom_teamAgentConfigs'>, '_id' | '_creationTime'>);
  return { configId, wasInsert: true };
}

async function projectTeamAgentConfigPatch(
  ctx: MutationCtx,
  existing: Doc<'chatroom_teamAgentConfigs'>,
  scope: PatchTeamAgentConfigOptions['projectScope'] = 'machine'
): Promise<void> {
  if (scope === 'chatroom') {
    await projectAgentOperationalStatusForRole(ctx, existing.chatroomId, existing.role, undefined, {
      config: existing,
    });
    return;
  }
  if (existing.machineId) {
    await projectAgentOperationalStatusForRole(ctx, existing.chatroomId, existing.role, undefined, {
      config: existing,
    });
    return;
  }
  await projectAgentOperationalStatusForRole(ctx, existing.chatroomId, existing.role, undefined, {
    config: existing,
  });
}
