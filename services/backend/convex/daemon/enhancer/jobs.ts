import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getDaemonMachineAuth } from './auth';
import { startEnhancerJobWork } from '../../../src/domain/usecase/enhancer/start-enhancer-job-work';
import type { Doc } from '../../_generated/dataModel';
import { mutation, query } from '../../_generated/server';
import { requireMachineOwner } from '../../auth/cli/machineAccess';

type PendingEnhancerJobDoc = Doc<'chatroom_enhancerJobs'>;

/** Shared pending-job projection so both queries can't drift on retry eligibility or shape. */
function toEligiblePendingJobs(jobs: PendingEnhancerJobDoc[], now: number) {
  return jobs
    .filter((j) => j.nextRetryAt === undefined || j.nextRetryAt <= now)
    .map((j) => ({
      jobId: j._id,
      chatroomId: j.chatroomId,
      agentHarness: j.agentHarness,
      model: j.model,
      workingDir: j.workingDir,
      attemptCount: j.attemptCount,
    }));
}

export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    // Imperative recovery drain (legacy worker), not a WS subscription.
    const auth = await getDaemonMachineAuth(ctx, args.sessionId, args.machineId);
    if (!auth) return [];

    const now = Date.now();
    const pending = await ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_machine_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();
    return toEligiblePendingJobs(pending, now);
  },
});

export const pendingForChatroom = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    // Composite machine+chatroom index: a write in another room never invalidates this watch.
    const auth = await getDaemonMachineAuth(ctx, args.sessionId, args.machineId);
    if (!auth) return [];

    const now = Date.now();
    const pending = await ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_machine_chatroom_status', (q) =>
        q.eq('machineId', args.machineId).eq('chatroomId', args.chatroomId).eq('status', 'pending')
      )
      .collect();
    return toEligiblePendingJobs(pending, now);
  },
});

export const claimForSpawn = mutation({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);

    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.machineId !== args.machineId) {
      return { claimed: false as const };
    }
    if (job.status !== 'pending') {
      return { claimed: false as const };
    }
    if (job.nextRetryAt !== undefined && job.nextRetryAt > Date.now()) {
      return { claimed: false as const };
    }

    await ctx.db.patch('chatroom_enhancerJobs', args.jobId, {
      status: 'running',
      runningSince: Date.now(),
    });

    const runningJob = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (runningJob) {
      await startEnhancerJobWork(ctx, runningJob);
    }

    return { claimed: true as const };
  },
});
