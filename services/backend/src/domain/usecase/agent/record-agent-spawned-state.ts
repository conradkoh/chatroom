/**
 * Convex state updates when a daemon-spawned agent starts (no event-stream insert).
 */

import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { projectAgentRoleStatusReadModel } from './project-agent-role-status-read-model';
import { transitionAgentStatus } from './transition-agent-status';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

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
    model?: string | undefined;
    harnessSessionId?: string | undefined;
    reason?: string | undefined;
  }
): Promise<void> {
  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });

  if (!launchRequest || launchRequest.machineId !== args.machineId) {
    throw new Error('Last-sent agent launch request not found');
  }

  const now = Date.now();
  const harness = launchRequest.agentHarness;
  const configWorkingDir = launchRequest.workingDir;
  const model = args.model ?? launchRequest.model;

  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.started');
  await projectAgentRoleStatusReadModel(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    launchRequest,
    event: { status: 'starting' },
    agentType: launchRequest.agentType,
    observedPid: args.pid,
    observedAt: now,
  });

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
