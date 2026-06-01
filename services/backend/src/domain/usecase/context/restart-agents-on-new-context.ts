/**
 * Restart remote agents that opted into auto-restart when pinned context changes.
 */

import { transitionAgentStatus } from '../agent/transition-agent-status';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function restartAgentsOnNewContext(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ restartedRoles: string[] }> {
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const now = Date.now();
  const restartedRoles: string[] = [];

  for (const config of configs) {
    if (!config.autoRestartOnNewContext) continue;
    if (config.type !== 'remote') continue;
    if (config.desiredState !== 'running') continue;
    if (!config.machineId || !config.agentHarness || !config.workingDir || !config.model) {
      continue;
    }

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.requestStart',
      chatroomId,
      machineId: config.machineId,
      role: config.role,
      agentHarness: config.agentHarness,
      model: config.model,
      workingDir: config.workingDir,
      reason: 'platform.new_context',
      deadline: now + AGENT_REQUEST_DEADLINE_MS,
      timestamp: now,
    });
    await transitionAgentStatus(ctx, chatroomId, config.role, 'agent.requestStart', 'running');
    restartedRoles.push(config.role);
  }

  return { restartedRoles };
}
