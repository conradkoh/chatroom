import type { MutationCtx } from '../../../../convex/_generated/server';
import { agentExited as agentExitedUseCase } from './agent-exited';
import { assertMachineBelongsToChatroom } from './assert-machine-belongs-to-chatroom';
import { recordAgentSpawnedState } from './record-agent-spawned-state';
import { transitionAgentStatus } from './transition-agent-status';
import { patchTeamAgentConfig } from '../machine/patch-team-agent-config';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { onAgentExited } from '../../../events/agent/on-agent-exited';
import { projectAssignedTaskSnapshotsForMachine } from '../machine/machine-assigned-task-snapshot-sync';
import type { Id } from '../../../../convex/_generated/dataModel';

export async function projectAgentLifecycleFact(ctx: MutationCtx, args: { machineId: string; fact: any }): Promise<{ success: true; skipped?: boolean; clearedCount?: number }> {
  const { machineId, fact } = args;
  if (fact.kind === 'cleared_all_pids') {
    const configs = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_machineId', (q) => q.eq('machineId', machineId)).collect();
    let clearedCount = 0;
    for (const config of configs) if (config.spawnedAgentPid != null) {
      await patchTeamAgentConfig(ctx, config._id, { spawnedAgentPid: undefined, spawnedAt: undefined }, { skipProject: true });
      await transitionAgentStatus(ctx, config.chatroomId, config.role, 'agent.exited', undefined);
      clearedCount++;
    }
    await projectAssignedTaskSnapshotsForMachine(ctx, machineId);
    return { success: true, clearedCount };
  }
  if (fact.kind === 'exited') {
    await agentExitedUseCase(ctx, { ...fact, machineId });
    await onAgentExited(ctx, { ...fact, machineId });
    return { success: true };
  }
  await assertMachineBelongsToChatroom(ctx, { chatroomId: fact.chatroomId as Id<'chatroom_rooms'>, machineId, role: fact.role, allowNewMachine: false });
  const room = await ctx.db.get(fact.chatroomId);
  const teamId = (room as { teamId?: string } | null)?.teamId;
  if (!teamId) return { success: true, skipped: true };
  const config = await ctx.db.query('chatroom_teamAgentConfigs').withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', buildTeamRoleKey(fact.chatroomId, teamId, fact.role))).first();
  if (!config) return { success: true, skipped: true };
  if (config.spawnedAgentPid === fact.pid) return { success: true, skipped: true };
  await patchTeamAgentConfig(ctx, config._id, { spawnedAgentPid: fact.pid, spawnedAt: Date.now(), ...(fact.model !== undefined ? { model: fact.model } : {}) });
  await recordAgentSpawnedState(ctx, { ...fact, machineId });
  return { success: true };
}
