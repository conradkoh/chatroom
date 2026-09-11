import { agentExited as agentExitedUseCase } from './agent-exited';
import { applyAgentActivityHeartbeat } from './apply-agent-activity-heartbeat';
import { completeChatroomWorkspaceAgentCommand } from './complete-chatroom-workspace-agent-command';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { registerSpawnedAgentIfAuthorized } from './register-spawned-agent';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { onAgentExited } from '../../../events/agent/on-agent-exited';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export type AgentLifecycleFactInput =
  | {
      kind: 'activity';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      action: string;
      taskId?: Id<'chatroom_tasks'> | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'spawned';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      model?: string | undefined;
      reason?: string | undefined;
      harnessSessionId?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'exited';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      stopReason?: string | undefined;
      stopSignal?: string | undefined;
      exitCode?: number | undefined;
      signal?: string | undefined;
      agentHarness?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'turn_failed';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      taskId?: Id<'chatroom_tasks'> | undefined;
      harnessSessionId?: string | undefined;
      turnId: string;
      status: string;
      source: string;
      error?: string | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | {
      kind: 'chatroom_shutdown_complete';
      chatroomId: Id<'chatroom_rooms'>;
      commandId: Id<'chatroomWorkspaceAgentCommandsInbox'>;
      finalizeChatroom?: boolean | undefined;
      revisionKey: string;
      emittedAt: number;
    }
  | { kind: 'cleared_all_pids'; revisionKey: string; emittedAt: number };

export async function projectAgentLifecycleFact(
  ctx: MutationCtx,
  args: { machineId: string; fact: AgentLifecycleFactInput }
): Promise<{
  success: true;
  skipped?: boolean | undefined;
  clearedCount?: number | undefined;
  reconciledExecutionCount?: number | undefined;
  rejectionReason?: string | undefined;
}> {
  const { machineId, fact } = args;
  if (fact.kind === 'activity') {
    const participant = await getParticipantForChatroomRole(ctx, fact.chatroomId, fact.role);
    await applyAgentActivityHeartbeat(ctx, { ...fact, participantId: participant?._id });
    return { success: true };
  }
  if (fact.kind === 'cleared_all_pids') {
    const configs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
      .collect();
    let clearedCount = 0;
    for (const config of configs)
      if (config.spawnedAgentPid != null) {
        await patchTeamAgentConfig(
          ctx,
          config._id,
          { spawnedAgentPid: undefined, spawnedAt: undefined },
          { skipProject: true }
        );
        await transitionAgentStatus(ctx, config.chatroomId, config.role, 'agent.exited', undefined);
        clearedCount++;
      }
    for (const config of configs) {
      await projectAgentOperationalStatusForRole(
        ctx,
        config.chatroomId,
        config.role,
        fact.revisionKey,
        { config }
      );
    }
    return { success: true, clearedCount };
  }
  if (fact.kind === 'exited') {
    const result = await agentExitedUseCase(ctx, {
      ...fact,
      machineId,
      revisionKey: fact.revisionKey,
    });
    if (result.applied) await onAgentExited(ctx, fact);
    return { success: true, skipped: !result.applied };
  }
  if (fact.kind === 'turn_failed') {
    await transitionAgentStatus(ctx, fact.chatroomId, fact.role, 'agent.turnFailed', undefined, {
      status: 'error',
      errorSource: 'runtime',
      errorCode: fact.status,
      errorMessage: `${fact.source}${fact.error ? `: ${fact.error}` : ''}`,
    });
    return { success: true };
  }
  if (fact.kind === 'chatroom_shutdown_complete') {
    return {
      success: true,
      ...(await completeChatroomWorkspaceAgentCommand(ctx, {
        commandId: fact.commandId,
        machineId,
        finalizeChatroom: fact.finalizeChatroom,
      })),
    };
  }
  const registration = await registerSpawnedAgentIfAuthorized(ctx, {
    ...fact,
    machineId,
  });
  if (!registration.accepted)
    return { success: true, skipped: true, rejectionReason: registration.reason };
  return { success: true };
}
