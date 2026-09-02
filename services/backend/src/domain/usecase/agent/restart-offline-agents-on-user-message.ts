import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

/**
 * Restart offline remote agents when a user sends a message.
 * Loads config from chatroom_teamAgentConfigs — no caller-supplied harness/model/workingDir.
 *
 * User messages bypass an open circuit breaker — sending a message is explicit retry intent,
 * same as manual start in start-agent.ts.
 */

import { isAgentAlive } from './is-agent-alive';
import { listTeamAgentConfigsForChatroom } from './list-team-agent-configs-for-chatroom';
import { requestAgentRestart } from './request-agent-restart';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isOfflineForUserMessageRestart } from '../../entities/participant';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

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
  _now: number
): Promise<void> {
  const needsDesiredState = config.desiredState !== 'running';
  const needsCircuitClose = config.circuitState === 'open';
  if (!needsDesiredState && !needsCircuitClose) return;
  await patchTeamAgentConfig(
    ctx,
    config._id,
    {
      ...(needsDesiredState ? { desiredState: 'running' as const } : {}),
      ...(needsCircuitClose ? { circuitState: 'closed' as const, circuitOpenedAt: undefined } : {}),
    },
    { skipProject: true }
  );
}

// fallow-ignore-next-line complexity
export async function restartOfflineAgentsOnUserMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ restartedRoles: string[] }> {
  const configs = await listTeamAgentConfigsForChatroom(ctx, chatroomId);
  // fallow-ignore-next-line code-duplication
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  const participantByRole = new Map(participants.map((p) => [p.role.toLowerCase(), p]));

  const restartedRoles: string[] = [];

  for (const config of configs) {
    if (isEphemeralAgentRole(config.role)) continue;
    if (!isRunnableRemoteConfig(config)) continue;

    const participant = participantByRole.get(config.role.toLowerCase());
    if (!shouldRestartForOfflineParticipant(participant, config.spawnedAgentPid)) continue;

    await ensureRunningClosedCircuit(ctx, config, Date.now());
    const result = await requestAgentRestart(ctx, {
      chatroomId,
      role: config.role,
      request: { reason: 'platform.restart_offline_on_user_message' },
    });
    if (result.status === 'requested') restartedRoles.push(config.role);
  }

  return { restartedRoles };
}
