import { agentExited as agentExitedUseCase } from './agent-exited';
import { applyAgentActivityHeartbeat } from './apply-agent-activity-heartbeat';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { reconcileOrphanedStopCommandsForMachine } from './reconcile-orphaned-stop-commands-for-machine';
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
      lifecycleRevision?: number | undefined;
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
        await patchTeamAgentConfig(ctx, config._id, { ...{}, ...{} }, { skipProject: true });
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
    const { reconciledExecutionCount } = await reconcileOrphanedStopCommandsForMachine(
      ctx,
      machineId
    );
    return { success: true, clearedCount, reconciledExecutionCount };
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
  if (fact.lifecycleRevision === undefined)
    return { success: true, skipped: true, rejectionReason: 'stale_revision' };
  const registration = await registerSpawnedAgentIfAuthorized(ctx, {
    ...fact,
    machineId,
    lifecycleRevision: fact.lifecycleRevision,
  });
  if (!registration.accepted)
    return { success: true, skipped: true, rejectionReason: registration.reason };
  return { success: true };
}
