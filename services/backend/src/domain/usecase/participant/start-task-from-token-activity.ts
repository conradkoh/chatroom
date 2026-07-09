import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isNativeHarness } from '../../entities/harness/types';
import {
  GET_NEXT_TASK_STOPPED_ACTION,
  NATIVE_TASK_INJECTED_ACTION,
} from '../../entities/participant';
import { getAgentConfig } from '../agent/get-agent-config';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { acknowledgePendingTask } from '../task/acknowledge-pending-task';
import { findAcknowledgedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { readTask } from '../task/read-task';
import { transitionTask } from '../task/transition-task';

type ParticipantSnapshot = {
  lastStatus?: string | null;
  lastSeenAction?: string | null;
};

function isStaleInFlightParticipantStatus(lastStatus?: string | null): boolean {
  return lastStatus === 'task.inProgress' || lastStatus === 'task.acknowledged';
}

function canResumeNativePendingFromTokenActivity(participant: ParticipantSnapshot): boolean {
  return (
    participant.lastStatus === 'agent.waiting' ||
    participant.lastStatus === 'agent.started' ||
    participant.lastStatus === 'agent.exited' ||
    isStaleInFlightParticipantStatus(participant.lastStatus)
  );
}

// fallow-ignore-next-line complexity
async function maybeStartAcknowledgedTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: ParticipantSnapshot
): Promise<boolean> {
  const acknowledgedTask = await findAcknowledgedTaskForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });

  const shouldStartTask =
    acknowledgedTask?.status === 'acknowledged' &&
    (participant.lastStatus === 'task.acknowledged' ||
      participant.lastStatus === 'agent.waiting' ||
      participant.lastStatus === 'agent.started' ||
      participant.lastSeenAction === NATIVE_TASK_INJECTED_ACTION ||
      participant.lastSeenAction === GET_NEXT_TASK_STOPPED_ACTION);

  if (!shouldStartTask) {
    return false;
  }

  await readTask(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    taskId: acknowledgedTask._id,
  });
  return true;
}

/** Pending task released after agent exit — source message was previously claimed. */
async function isReleasedNativePendingResume(
  ctx: MutationCtx,
  pendingTask: Doc<'chatroom_tasks'>
): Promise<boolean> {
  if (!pendingTask.sourceMessageId) {
    return false;
  }
  const sourceMessage = await ctx.db.get('chatroom_messages', pendingTask.sourceMessageId);
  return sourceMessage?.acknowledgedAt != null;
}

/** True when pending task was in-flight before agent exit (participant or message still shows prior claim). */
async function isRecoveredPendingTask(
  ctx: MutationCtx,
  pendingTask: Doc<'chatroom_tasks'>,
  participant: ParticipantSnapshot
): Promise<boolean> {
  if (isStaleInFlightParticipantStatus(participant.lastStatus)) {
    return true;
  }
  if (participant.lastSeenAction === NATIVE_TASK_INJECTED_ACTION) {
    return true;
  }
  return isReleasedNativePendingResume(ctx, pendingTask);
}

async function resumeRecoveredPendingTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  pendingTask: Doc<'chatroom_tasks'>
): Promise<void> {
  await transitionTask(ctx, pendingTask._id, 'in_progress', 'resumeFromTokenActivity');
  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.inProgress');
}

// fallow-ignore-next-line complexity
async function maybeStartPendingTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: ParticipantSnapshot
): Promise<void> {
  const pendingTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status_assignedTo', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'pending').eq('assignedTo', args.role)
    )
    .collect();

  const topPending = pendingTasks.sort((a, b) => a.queuePosition - b.queuePosition)[0];
  if (!topPending) {
    return;
  }

  const agentConfig = await getAgentConfig(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
  const isNative =
    agentConfig.found &&
    agentConfig.config.agentHarness &&
    isNativeHarness(agentConfig.config.agentHarness);

  if (isNative) {
    if (!canResumeNativePendingFromTokenActivity(participant)) {
      return;
    }
    const isRecovered = await isRecoveredPendingTask(ctx, topPending, participant);
    if (!isRecovered) {
      return;
    }
    await resumeRecoveredPendingTaskFromTokenActivity(ctx, args, topPending);
    return;
  }

  if (participant.lastStatus !== 'agent.waiting') {
    return;
  }

  await acknowledgePendingTask(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    pendingTask: topPending,
  });
  await readTask(ctx, { chatroomId: args.chatroomId, role: args.role, taskId: topPending._id });
}

/** Starts acknowledged or pending work when harness token activity resumes after agent.waiting. */
export async function startTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: ParticipantSnapshot
): Promise<void> {
  const startedAcknowledged = await maybeStartAcknowledgedTaskFromTokenActivity(
    ctx,
    args,
    participant
  );
  if (startedAcknowledged) {
    return;
  }

  await maybeStartPendingTaskFromTokenActivity(ctx, args, participant);
}
