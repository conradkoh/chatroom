/**
 * Restart offline remote agents when a user sends a message.
 * Loads config from chatroom_teamAgentConfigs — no caller-supplied harness/model/workingDir.
 *
 * User messages bypass an open circuit breaker — sending a message is explicit retry intent,
 * same as manual start in start-agent.ts.
 */

import { isAgentAlive } from './is-agent-alive';
import { listTeamAgentConfigsForChatroom } from './list-team-agent-configs-for-chatroom';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isOfflineForUserMessageRestart } from '../../entities/participant';
import { buildAgentRequestStartEvent } from '../agent/build-agent-request-start-event';
import { transitionAgentStatus } from '../agent/transition-agent-status';

type TeamAgentConfig = Doc<'chatroom_teamAgentConfigs'>;

type RunnableRemoteConfig = TeamAgentConfig & {
  machineId: string;
  agentHarness: NonNullable<TeamAgentConfig['agentHarness']>;
  model: string;
  workingDir: string;
};

function isRunnableRemoteConfig(config: TeamAgentConfig): config is RunnableRemoteConfig {
  if (config.type !== 'remote') return false;
  return Boolean(config.machineId && config.agentHarness && config.workingDir && config.model);
}

function shouldRestartForOfflineParticipant(
  participant: Doc<'chatroom_participants'> | undefined,
  spawnedAgentPid: number | undefined
): boolean {
  return isOfflineForUserMessageRestart({
    lastStatus: participant?.lastStatus,
    lastDesiredState: 'running',
    lastSeenAction: participant?.lastSeenAction,
    isAlive: isAgentAlive(spawnedAgentPid),
  });
}

async function ensureRunningClosedCircuit(
  ctx: MutationCtx,
  config: TeamAgentConfig,
  now: number
): Promise<void> {
  const needsDesiredState = config.desiredState !== 'running';
  const needsCircuitClose = config.circuitState === 'open';
  if (!needsDesiredState && !needsCircuitClose) return;
  await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
    ...(needsDesiredState ? { desiredState: 'running' as const } : {}),
    ...(needsCircuitClose ? { circuitState: 'closed' as const, circuitOpenedAt: undefined } : {}),
    updatedAt: now,
  });
}

async function emitOfflineUserMessageRestart(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  config: RunnableRemoteConfig,
  now: number
): Promise<void> {
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
      },
      now
    )
  );
  await transitionAgentStatus(ctx, chatroomId, config.role, 'agent.requestStart', 'running');
}

export async function restartOfflineAgentsOnUserMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ restartedRoles: string[] }> {
  const configs = await listTeamAgentConfigsForChatroom(ctx, chatroomId);
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p]));

  const now = Date.now();
  const restartedRoles: string[] = [];

  for (const config of configs) {
    if (!isRunnableRemoteConfig(config)) continue;

    const participant = participantByRole.get(config.role.toLowerCase());
    if (!shouldRestartForOfflineParticipant(participant, config.spawnedAgentPid)) continue;

    await ensureRunningClosedCircuit(ctx, config, now);
    await emitOfflineUserMessageRestart(ctx, chatroomId, config, now);
    restartedRoles.push(config.role);
  }

  return { restartedRoles };
}
