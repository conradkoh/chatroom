import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

export function assertEnhancerJobOwner(
  job: Doc<'chatroom_enhancerJobs'>,
  userId: Id<'users'>
): void {
  if (job.userId !== userId) {
    throw new ConvexError({
      code: 'NOT_AUTHORIZED_JOB',
      message: 'Not authorized for this enhancer job',
    });
  }
}

export async function findActiveEnhancerJob(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  fromRole: string,
  toRole: string
): Promise<Doc<'chatroom_enhancerJobs'> | null> {
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

  const active = [...pending, ...running]
    .filter((job) => job.fromRole === fromRole && job.toRole === toRole)
    .sort((a, b) => b.createdAt - a.createdAt);

  return active[0] ?? null;
}

export function isActiveEnhancerStatus(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}
