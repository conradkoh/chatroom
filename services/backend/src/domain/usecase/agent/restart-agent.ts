/**
 * Use Case: Restart Agent
 *
 * Atomic user restart: release in-flight tasks to pending, persist config,
 * emit agent.restart for the daemon orchestrator.
 */

import { buildAgentRestartEvent } from './build-agent-restart-event';
import { resolveDefaultWantResume } from './resolve-default-want-resume';
import { transitionAgentStatus } from './transition-agent-status';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import type { AgentHarness, AgentType } from '../../entities/agent';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';
import { upsertTeamAgentConfigByTeamRoleKey } from '../machine/patch-team-agent-config';
import { releaseTasksOnAgentExit } from '../task/release-tasks-on-agent-exit';

export interface RestartAgentInput {
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  userId: Id<'users'>;
  model: string;
  agentHarness: AgentHarness;
  workingDir: string;
  wantResume?: boolean;
}

export interface RestartAgentResult {
  correlationId: string;
  releasedTaskCount: number;
}

export async function restartAgent(
  ctx: MutationCtx,
  input: RestartAgentInput,
  machine: Doc<'chatroom_machines'>
): Promise<RestartAgentResult> {
  const { machineId, chatroomId, role, model, agentHarness, workingDir } = input;

  if (!machine.availableHarnesses.includes(agentHarness)) {
    throw new Error(`Agent harness '${agentHarness}' is not available on this machine`);
  }

  const releasedTaskCount = await releaseTasksOnAgentExit(ctx, { chatroomId, role });

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const resolvedWantResume =
    input.wantResume ?? (chatroom?.teamId ? resolveDefaultWantResume(chatroom.teamId, role) : true);
  const now = Date.now();
  const correlationId = crypto.randomUUID();

  if (chatroom?.teamId) {
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
    await upsertTeamAgentConfigByTeamRoleKey(ctx, {
      teamRoleKey,
      createdAt: now,
      fields: {
        chatroomId,
        role,
        type: 'remote' as AgentType,
        machineId,
        agentHarness,
        model,
        workingDir,
        updatedAt: now,
        desiredState: 'running' as const,
        wantResume: resolvedWantResume,
        circuitState: 'closed' as const,
        circuitOpenedAt: undefined,
      },
    });
  }

  await ctx.db.insert(
    'chatroom_eventStream',
    buildAgentRestartEvent(
      {
        chatroomId,
        machineId,
        role,
        agentHarness,
        model,
        workingDir,
        correlationId,
        wantResume: resolvedWantResume,
      },
      now
    )
  );

  await transitionAgentStatus(ctx, chatroomId, role, 'agent.restart', 'running');
  await projectAssignedTaskSnapshotsForChatroom(ctx, chatroomId);

  return { correlationId, releasedTaskCount };
}
