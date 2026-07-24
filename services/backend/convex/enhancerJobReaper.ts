/**
 * Enhancer job reaper — fails stuck running jobs and purges old terminal rows.
 */

import { internal } from './_generated/api';
import { ENHANCER_TERMINAL_JOB_RETENTION_MS } from '../config/reliability';
import { internalMutation } from './_generated/server';

const JOBS_PER_BATCH = 50;
const MAX_PATCHES_PER_MUTATION = 100;

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
