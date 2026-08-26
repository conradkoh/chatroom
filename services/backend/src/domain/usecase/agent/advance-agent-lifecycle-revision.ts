import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export async function advanceAgentLifecycleRevision(ctx: MutationCtx, configId: Id<'chatroom_teamAgentConfigs'>): Promise<number> {
  const config = await ctx.db.get('chatroom_teamAgentConfigs', configId);
  if (!config) throw new Error('Agent config not found');
  const next = (config.lifecycleRevision ?? 0) + 1;
  await patchTeamAgentConfig(ctx, configId, { lifecycleRevision: next });
  return next;
}
