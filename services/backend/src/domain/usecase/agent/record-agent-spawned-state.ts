/**
 * Convex state updates when a daemon-spawned agent starts (no event-stream insert).
 */

import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';

async function upsertRestartMetricForHour(
  ctx: MutationCtx,
  args: {
    machineId: string;
    role: string;
    chatroomId: Id<'chatroom_rooms'>;
    workingDir: string;
    model: string;
    agentType: string;
    hourBucket: number;
  }
): Promise<void> {
  const existingMetric = await ctx.db
    .query('chatroom_agentRestartMetrics')
    .withIndex('by_machine_role_hour', (q) =>
      q.eq('machineId', args.machineId).eq('role', args.role).eq('hourBucket', args.hourBucket)
    )
    .filter((q) =>
      q.and(
        q.eq(q.field('chatroomId'), args.chatroomId),
        q.eq(q.field('model'), args.model),
        q.eq(q.field('workingDir'), args.workingDir),
        q.eq(q.field('agentType'), args.agentType)
      )
    )
    .first();

  if (existingMetric) {
    await ctx.db.patch('chatroom_agentRestartMetrics', existingMetric._id, {
      count: existingMetric.count + 1,
    });
    return;
  }

  await ctx.db.insert('chatroom_agentRestartMetrics', {
    machineId: args.machineId,
    role: args.role,
    chatroomId: args.chatroomId,
    workingDir: args.workingDir,
    model: args.model,
    agentType: args.agentType,
    hourBucket: args.hourBucket,
    count: 1,
  });
}

export async function recordAgentSpawnedState(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    machineId: string;
    pid: number;
    model?: string;
    harnessSessionId?: string;
    reason?: string;
  }
): Promise<void> {
  const spawnChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!spawnChatroom?.teamId) {
    throw new Error('Chatroom has no teamId — cannot look up agent config');
  }

  const spawnTeamRoleKey = buildTeamRoleKey(spawnChatroom._id, spawnChatroom.teamId, args.role);
  const config = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', spawnTeamRoleKey))
    .first();

  if (!config || config.machineId !== args.machineId) {
    throw new Error('Agent config not found');
  }

  const now = Date.now();
  const harness = config.agentHarness ?? 'opencode';
  const configWorkingDir = config.workingDir ?? '/unknown';
  const model = args.model ?? config.model ?? 'unknown';

  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.started');

  await upsertRestartMetricForHour(ctx, {
    machineId: args.machineId,
    role: args.role,
    chatroomId: args.chatroomId,
    workingDir: configWorkingDir,
    model,
    agentType: harness as string,
    hourBucket: Math.floor(now / 3_600_000) * 3_600_000,
  });
}
