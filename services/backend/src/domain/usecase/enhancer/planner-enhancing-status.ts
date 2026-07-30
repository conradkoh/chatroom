import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import { findActiveEnhancerJob } from '../../../../convex/web/enhancer/jobHelpers';
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

/** Set planner status while a handoff enhancer job is in flight. */
export async function transitionPlannerToEnhancing(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.enhancing',
    chatroomId,
    role: 'planner',
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, 'planner', 'agent.enhancing');
}

/** Clear enhancing status after enhancer job finishes or handoff is delivered. */
export async function transitionPlannerFromEnhancingToWaiting(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const now = Date.now();
  await emitParticipantStatusEvent(ctx, {
    type: 'agent.waiting',
    chatroomId,
    role: 'planner',
    timestamp: now,
  });
  await transitionAgentStatus(ctx, chatroomId, 'planner', 'agent.waiting');
}

export async function hasActivePlannerEnhancerJob(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const active = await findActiveEnhancerJob(ctx, chatroomId, 'planner', 'enhancer');
  return active !== null;
}

const ACTIVE_ENHANCER_JOB_STATUSES = ['pending', 'running'] as const;

/** Chatroom IDs with active enhancer jobs or enhancer-assigned tasks owned by the user. */
export async function listChatroomIdsWithActiveEnhancerWork(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Id<'chatroom_rooms'>[]> {
  const chatroomIds = new Set<Id<'chatroom_rooms'>>();

  for (const status of ACTIVE_ENHANCER_JOB_STATUSES) {
    const jobs = await ctx.db
      .query('chatroom_enhancerJobs')
      .withIndex('by_userId_status', (q) => q.eq('userId', userId).eq('status', status))
      .collect();
    for (const job of jobs) {
      if (job.fromRole === 'planner' && job.toRole === 'enhancer') {
        chatroomIds.add(job.chatroomId);
      }
    }
  }

  const taskChatroomIds = new Set<Id<'chatroom_rooms'>>();
  for (const status of ACTIVE_TASK_STATUSES) {
    const tasks = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_assignedTo_status', (q) => q.eq('assignedTo', 'enhancer').eq('status', status))
      .collect();
    for (const task of tasks) {
      taskChatroomIds.add(task.chatroomId);
    }
  }

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
  if (await hasActivePlannerEnhancerJob(ctx, chatroomId)) {
    return true;
  }
  return hasActiveEnhancerTask(ctx, chatroomId);
}
