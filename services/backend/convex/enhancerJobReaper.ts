/**
 * Enhancer job reaper — fails stuck running jobs and purges old terminal rows.
 */

import { internal } from './_generated/api';
import {
  ENHANCER_ATTEMPT_TIMEOUT_MS,
  ENHANCER_TERMINAL_JOB_RETENTION_MS,
} from '../config/reliability';
import { internalMutation } from './_generated/server';
import { computeEnhancerBackoffMs, emitEnhancerEvent } from './web/enhancer/internal';

const JOBS_PER_BATCH = 50;
const MAX_PATCHES_PER_MUTATION = 100;

// fallow-ignore-next-line complexity
export const reapStuckEnhancerJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuckBefore = now - ENHANCER_ATTEMPT_TIMEOUT_MS;
    let patches = 0;

    const runningJobs = await ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_status_nextRetryAt', (q) => q.eq('status', 'running'))
      .take(JOBS_PER_BATCH);

    for (const job of runningJobs) {
      if (patches >= MAX_PATCHES_PER_MUTATION) break;
      if (!job.runningSince || job.runningSince > stuckBefore) continue;

      const attemptCount = job.attemptCount;
      if (attemptCount >= job.maxAttempts) {
        await ctx.db.patch('chatroom_enhancerJobs', job._id, {
          status: 'failed',
          lastError: 'Attempt timed out (reaper)',
          completedAt: now,
          runningSince: undefined,
        });
        await emitEnhancerEvent(
          ctx,
          {
            type: 'enhancer.job.failed' as const,
            chatroomId: job.chatroomId,
            jobId: job._id,
            attemptCount,
            error: 'Attempt timed out (reaper)',
          },
          now
        );
      } else {
        const nextRetryAt = now + computeEnhancerBackoffMs(attemptCount);
        await ctx.db.patch('chatroom_enhancerJobs', job._id, {
          status: 'pending',
          attemptCount: attemptCount + 1,
          lastError: 'Attempt timed out (reaper)',
          nextRetryAt,
          runningSince: undefined,
        });
        await emitEnhancerEvent(
          ctx,
          {
            type: 'enhancer.attempt.failed' as const,
            chatroomId: job.chatroomId,
            jobId: job._id,
            attemptCount,
            error: 'Attempt timed out (reaper)',
            nextRetryAt,
          },
          now
        );
      }
      patches++;
    }

    if (patches > 0) {
      console.log(`[EnhancerReaper] Reaped ${patches} stuck running job(s)`);
    }

    if (runningJobs.length === JOBS_PER_BATCH && patches >= MAX_PATCHES_PER_MUTATION) {
      await ctx.scheduler.runAfter(0, internal.enhancerJobReaper.reapStuckEnhancerJobs);
    }
  },
});

// fallow-ignore-next-line complexity
export const purgeTerminalEnhancerJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ENHANCER_TERMINAL_JOB_RETENTION_MS;
    let deleted = 0;

    for (const status of ['complete', 'failed', 'cancelled'] as const) {
      const terminal = await ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_status_nextRetryAt', (q) => q.eq('status', status))
        .take(JOBS_PER_BATCH);

      for (const job of terminal) {
        if (deleted >= MAX_PATCHES_PER_MUTATION) break;
        if (!job.completedAt || job.completedAt > cutoff) continue;
        await ctx.db.delete('chatroom_enhancerJobs', job._id);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[EnhancerReaper] Purged ${deleted} terminal enhancer job(s)`);
    }

    if (deleted >= MAX_PATCHES_PER_MUTATION) {
      await ctx.scheduler.runAfter(0, internal.enhancerJobReaper.purgeTerminalEnhancerJobs);
    }
  },
});
