import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { releaseTasksOnAgentExit } from '../task/release-tasks-on-agent-exit';
import { transitionEnhancerEntryPointToWaiting } from './enhancer-entry-point-status';

/** Silently interrupt enhancer work without delivering a planning handoff. */
export async function interruptEnhancerJobsOnChatroomStop(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ interruptedJobIds: Id<'chatroom_enhancerJobs'>[] }> {
  const [pending, running] = await Promise.all([
    ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'pending')
      )
      .collect(),
    ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_chatroom_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', 'running')
      )
      .collect(),
  ]);
  const jobs = [...pending, ...running].filter((job) => job.toRole === 'enhancer');
  const interruptedJobIds: Id<'chatroom_enhancerJobs'>[] = [];

  await releaseTasksOnAgentExit(ctx, { chatroomId, role: 'enhancer' });

  for (const job of jobs) {
    if (job.status === 'running') {
      await ctx.db.patch('chatroom_enhancerJobs', job._id, {
        status: 'pending',
        runningSince: undefined,
        lastError: 'interrupted_by_stop',
      });
      interruptedJobIds.push(job._id);
    }
    await transitionEnhancerEntryPointToWaiting(ctx, chatroomId, job.fromRole);
  }

  return { interruptedJobIds };
}
