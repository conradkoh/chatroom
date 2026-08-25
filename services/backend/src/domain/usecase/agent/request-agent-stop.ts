/**
 * Use Case: Request Agent Stop
 *
 * Records stop intent and enqueues `agent.requestStop` for the daemon.
 * Does not clear PID, transition participant status, or release tasks —
 * those happen only after the daemon confirms harness termination.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentStopReason } from '../../entities/agent';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export interface RequestAgentStopInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  reason: AgentStopReason;
}

export interface RequestAgentStopResult {
  /** Empty — delivery is via machine command inbox. */
}

// fallow-ignore-next-line complexity
export async function requestAgentStop(
  ctx: MutationCtx,
  input: RequestAgentStopInput
): Promise<RequestAgentStopResult> {
  const { machineId, chatroomId, role, reason } = input;
  const now = Date.now();

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  let teamConfig = null;
  if (chatroom?.teamId) {
    const teamRoleKey = buildTeamRoleKey(chatroomId, chatroom.teamId, role);
    teamConfig = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();
  }

  await enqueueMachineCommand(ctx, {
    machineId,
    now,
    command: {
      type: 'agent.requestStop',
      chatroomId,
      role,
      reason,
      pid: teamConfig?.spawnedAgentPid ?? undefined,
    },
  });

  if (teamConfig) {
    await patchTeamAgentConfig(
      ctx,
      teamConfig._id,
      { desiredState: 'stopped' },
      { projectScope: 'chatroom' }
    );
  }

  return {};
}
