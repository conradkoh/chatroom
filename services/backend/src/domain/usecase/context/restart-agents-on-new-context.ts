/**
 * Restart remote agents that opted into auto-restart when pinned context changes.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildAgentRequestStartEvent } from '../agent/build-agent-request-start-event';
import { listTeamAgentConfigsForChatroom } from '../agent/list-team-agent-configs-for-chatroom';
import { transitionAgentStatus } from '../agent/transition-agent-status';

export async function restartAgentsOnNewContext(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ restartedRoles: string[] }> {
  const configs = await listTeamAgentConfigsForChatroom(ctx, chatroomId);

  const now = Date.now();
  const restartedRoles: string[] = [];

  for (const config of configs) {
    if (!config.autoRestartOnNewContext) continue;
    if (config.type !== 'remote') continue;
    if (config.desiredState !== 'running') continue;
    if (!config.machineId || !config.agentHarness || !config.workingDir || !config.model) {
      continue;
    }

    await ctx.db.insert(
      'chatroom_eventStream',
      buildAgentRequestStartEvent(
        {
          chatroomId,
          machineId: config.machineId,
          role: config.role,
          agentHarness: config.agentHarness,
          model: config.model,
          workingDir: config.workingDir,
          reason: 'platform.auto_restart_on_new_context',
          // A new pinned context is a deliberate fresh start: do NOT resume the
          // prior harness session even if the persisted preference was true.
          wantResume: false,
          autoRestartOnNewContext: config.autoRestartOnNewContext,
        },
        now
      )
    );
    await transitionAgentStatus(ctx, chatroomId, config.role, 'agent.requestStart', 'running');
    restartedRoles.push(config.role);
  }

  return { restartedRoles };
}
