import { agentExited as agentExitedUseCase } from './agent-exited';
import { projectAgentOperationalStatusForRole } from './project-agent-operational-status';
import { registerSpawnedAgentIfAuthorized } from './register-spawned-agent';
import { transitionAgentStatus } from './transition-agent-status';
import { applyAgentActivityHeartbeat } from './apply-agent-activity-heartbeat';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { onAgentExited } from '../../../events/agent/on-agent-exited';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';

export type AgentLifecycleFactInput =
  | { kind: 'activity'; chatroomId: Id<'chatroom_rooms'>; role: string; action: string; taskId?: Id<'chatroom_tasks'>; revisionKey: string; emittedAt: number }
  | {
      kind: 'spawned';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      model?: string;
      reason?: string;
      harnessSessionId?: string;
      revisionKey: string;
      emittedAt: number;
      lifecycleRevision?: number;
    }
  | {
      kind: 'exited';
      chatroomId: Id<'chatroom_rooms'>;
      role: string;
      pid: number;
      stopReason?: string;
      stopSignal?: string;
      exitCode?: number;
      signal?: string;
      agentHarness?: string;
      revisionKey: string;
      emittedAt: number;
    }
  | { kind: 'cleared_all_pids'; revisionKey: string; emittedAt: number };

export async function projectAgentLifecycleFact(
  ctx: MutationCtx,
  args: { machineId: string; fact: AgentLifecycleFactInput }
): Promise<{ success: true; skipped?: boolean; clearedCount?: number; rejectionReason?: string }> {
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
