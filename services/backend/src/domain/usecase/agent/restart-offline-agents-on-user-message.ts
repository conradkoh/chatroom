/**
 * Restart offline remote agents when a user sends a message.
 * Loads config from chatroom_teamAgentConfigs — no caller-supplied harness/model/workingDir.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isOfflineForUserMessageRestart } from '../../entities/participant';
import { buildAgentRequestStartEvent } from '../agent/build-agent-request-start-event';
import { transitionAgentStatus } from '../agent/transition-agent-status';

export async function restartOfflineAgentsOnUserMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ restartedRoles: string[] }> {
  const configs = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p]));

  const now = Date.now();
  const restartedRoles: string[] = [];

  for (const config of configs) {
    if (config.type !== 'remote') continue;
    if (config.desiredState === 'stopped') continue;
    if (config.circuitState === 'open') continue;
    if (!config.machineId || !config.agentHarness || !config.workingDir || !config.model) {
      continue;
    }

    const participant = participantByRole.get(config.role.toLowerCase());
    if (
      participant &&
      !isOfflineForUserMessageRestart({
        lastStatus: participant.lastStatus,
        lastDesiredState: participant.lastDesiredState,
        lastSeenAction: participant.lastSeenAction,
      })
    ) {
      continue;
    }
    // No participant row yet but config exists + desiredState running → treat as offline

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
          reason: 'platform.restart_offline_on_user_message',
          wantResume: config.wantResume ?? true,
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
