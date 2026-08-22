import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import {
  findActiveEnhancerJob,
  findActiveEnhancerJobForChatroom,
} from '../../../../convex/web/enhancer/jobHelpers';
import { transitionAgentStatus } from '../agent/transition-agent-status';

const ACTIVE_TASK_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

async function hasActiveEnhancerTask(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  for (const status of ACTIVE_TASK_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status_assignedTo', (q) =>
        q.eq('chatroomId', chatroomId).eq('status', status).eq('assignedTo', 'enhancer')
      )
      .first();
    if (tasks) return true;
  }
  return false;
}

async function emitParticipantStatusEvent(
  ctx: MutationCtx,
  params: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    type: 'agent.enhancing' | 'agent.waiting';
    timestamp: number;
  }
): Promise<void> {
  await ctx.db.insert('chatroom_eventStream', {
    type: params.type,
    chatroomId: params.chatroomId,
    role: params.role,
    timestamp: params.timestamp,
  });
}

/** Set the persistent entry-point agent's status while enhancer work is in flight. */
export async function transitionEnhancerEntryPointToEnhancing(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.enhancing',
    chatroomId,
    role: entryPointRole,
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, entryPointRole, 'agent.enhancing');
}

/** Clear the entry-point agent's enhancing status after the advisory pass ends. */
export async function transitionEnhancerEntryPointToWaiting(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.waiting',
    chatroomId,
    role: entryPointRole,
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, entryPointRole, 'agent.waiting');
}

export async function hasActiveEntryPointEnhancerJob(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  entryPointRole: string
): Promise<boolean> {
  const active = await findActiveEnhancerJob(ctx, chatroomId, entryPointRole, 'enhancer');
  return active !== null;
}

const ACTIVE_ENHANCER_JOB_STATUSES = ['pending', 'running'] as const;

async function listActiveJobChatroomIds(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Id<'chatroom_rooms'>[]> {
  const jobBatches = await Promise.all(
    ACTIVE_ENHANCER_JOB_STATUSES.map((status) =>
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_userId_status', (q) => q.eq('userId', userId).eq('status', status))
        .collect()
    )
  );
  return jobBatches
    .flat()
    .filter((job) => job.toRole === 'enhancer')
    .map((job) => job.chatroomId);
}

async function listActiveTaskChatroomIds(ctx: QueryCtx): Promise<Id<'chatroom_rooms'>[]> {
  const taskBatches = await Promise.all(
    ACTIVE_TASK_STATUSES.map((status) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_assignedTo_status', (q) =>
          q.eq('assignedTo', 'enhancer').eq('status', status)
        )
        .collect()
    )
  );
  return taskBatches.flat().map((task) => task.chatroomId);
}

/** Chatroom IDs with active enhancer jobs or enhancer-assigned tasks owned by the user. */
export async function listChatroomIdsWithActiveEnhancerWork(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Id<'chatroom_rooms'>[]> {
  const chatroomIds = new Set(await listActiveJobChatroomIds(ctx, userId));
  const taskChatroomIds = new Set(await listActiveTaskChatroomIds(ctx));

  for (const chatroomId of taskChatroomIds) {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    if (chatroom?.ownerId === userId) {
      chatroomIds.add(chatroomId);
    }
  }

  return [...chatroomIds];
}

/** True while an enhancer job or enhancer task row is in flight. */
export async function hasActiveEnhancerWork(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  if (await findActiveEnhancerJobForChatroom(ctx, chatroomId)) {
    return true;
  }
  return hasActiveEnhancerTask(ctx, chatroomId);
}
