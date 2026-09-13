// fallow-ignore-file complexity

/** Centralized team agent config writes and operational-state projection. */
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { deleteStaleTeamAgentConfigs } from '../agent/delete-stale-team-agent-configs';

type AllowUndefinedForOptionalProperties<T> = {
  [K in keyof T]: {} extends Pick<T, K> ? T[K] | undefined : T[K];
};

type TeamAgentConfigUpsertFields = AllowUndefinedForOptionalProperties<
  Omit<Doc<'chatroom_agentDesiredConfigs'>, '_id' | '_creationTime' | 'teamRoleKey' | 'createdAt'>
>;

export type UpsertTeamAgentConfigResult = {
  configId: Id<'chatroom_agentDesiredConfigs'>;
  previousMachineId?: string | undefined;
  wasInsert: boolean;
};

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
    .query('chatroom_agentDesiredConfigs')
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
      'chatroom_agentDesiredConfigs',
      existing._id,
      fields as unknown as Partial<Doc<'chatroom_agentDesiredConfigs'>>
    );
    return {
      configId: existing._id,
      previousMachineId: existing.machineId,
      wasInsert: false,
    };
  }

  await deleteStaleTeamAgentConfigs(ctx, args.teamRoleKey);
  const configId = await ctx.db.insert('chatroom_agentDesiredConfigs', {
    ...fields,
    enabled: fields.enabled ?? true,
    createdAt: args.createdAt ?? now,
  } as unknown as Omit<Doc<'chatroom_agentDesiredConfigs'>, '_id' | '_creationTime'>);
  return { configId, wasInsert: true };
}
