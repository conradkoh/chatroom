import { ConvexError } from 'convex/values';

import { getDaemonMachineAuth } from './auth';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

/**
 * Loads a running enhancer job and authorizes the requesting daemon machine.
 *
 * Shared guard for every daemon-facing enhancer job query: throws
 * `NOT_FOUND` when the job is missing or not running, and
 * `NOT_AUTHORIZED_MACHINE` when the session does not belong to the machine
 * that owns the job.
 */
export async function loadRunningEnhancerJobForMachine(
  ctx: QueryCtx | MutationCtx,
  args: {
    sessionId: string;
    jobId: Id<'chatroom_enhancerJobs'>;
  }
) {
  const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
  if (!job || job.status !== 'running') {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not running' });
  }

  const auth = await getDaemonMachineAuth(ctx, args.sessionId, job.machineId);
  if (!auth) {
    throw new ConvexError({
      code: 'NOT_AUTHORIZED_MACHINE',
      message: 'Not authorized for this machine',
    });
  }

  return job;
}
