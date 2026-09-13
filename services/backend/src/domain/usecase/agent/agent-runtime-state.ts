/** Persistence boundary for system-owned agent runtime state. */

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = MutationCtx | QueryCtx;
type DesiredConfig = Doc<'chatroom_agentDesiredConfigs'>;
type RuntimeState = Doc<'chatroom_agentRuntimeStates'>;

type RuntimeFields = Omit<RuntimeState, '_id' | '_creationTime' | 'desiredConfigId'>;
export type RuntimePatch = {
  [K in keyof RuntimeFields]?: RuntimeFields[K] | undefined;
};

export async function getAgentRuntimeState(
  ctx: DbCtx,
  desiredConfigId: Id<'chatroom_agentDesiredConfigs'>
): Promise<RuntimeState | null> {
  return (
    (await ctx.db
      .query('chatroom_agentRuntimeStates')
      .withIndex('by_desiredConfig', (q) => q.eq('desiredConfigId', desiredConfigId))
      .first()) ?? null
  );
}

export async function getOrCreateAgentRuntimeState(
  ctx: MutationCtx,
  config: DesiredConfig,
  patch: RuntimePatch = {}
): Promise<RuntimeState> {
  const existing = await getAgentRuntimeState(ctx, config._id);
  if (existing) return existing;

  const now = Date.now();
  const id = await ctx.db.insert('chatroom_agentRuntimeStates', {
    desiredConfigId: config._id,
    chatroomId: config.chatroomId,
    role: config.role,
    workspaceId: config.workspaceId,
    machineId: config.machineId,
    status: 'offline',
    updatedAt: now,
    ...patch,
  } as unknown as Omit<RuntimeState, '_id' | '_creationTime'>);
  const created = await ctx.db.get('chatroom_agentRuntimeStates', id);
  if (!created) throw new Error('Failed to create agent runtime state');
  return created;
}

export async function patchAgentRuntimeState(
  ctx: MutationCtx,
  config: DesiredConfig,
  patch: RuntimePatch
): Promise<RuntimeState> {
  const existing = await getOrCreateAgentRuntimeState(ctx, config);
  await ctx.db.patch('chatroom_agentRuntimeStates', existing._id, {
    ...patch,
    updatedAt: Date.now(),
  } as unknown as Partial<RuntimeState>);
  const updated = await ctx.db.get('chatroom_agentRuntimeStates', existing._id);
  if (!updated) throw new Error('Failed to update agent runtime state');
  return updated;
}
