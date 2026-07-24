import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { getDaemonMachineAuth } from './auth';
import { mutation, query } from '../../_generated/server';

export const pendingForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getDaemonMachineAuth(ctx, args.sessionId, args.machineId);
    if (!auth) return [];

    const now = Date.now();
    const pending = await ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_machine_status', (q) =>
        q.eq('machineId', args.machineId).eq('status', 'pending')
      )
      .collect();
    return pending
      .filter((j) => j.nextRetryAt === undefined || j.nextRetryAt <= now)
      .map((j) => ({
        jobId: j._id,
        chatroomId: j.chatroomId,
        agentHarness: j.agentHarness,
        model: j.model,
        workingDir: j.workingDir,
        attemptCount: j.attemptCount,
      }));
  },
});

export const claimForSpawn = mutation({
  args: {
    ...SessionIdArg,
    jobId: v.id('chatroom_enhancerJobs'),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getDaemonMachineAuth(ctx, args.sessionId, args.machineId);
    if (!auth) {
      return { claimed: false as const };
    }

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
    return { claimed: true as const };
  },
});
