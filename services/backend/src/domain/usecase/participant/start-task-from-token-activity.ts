import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isNativeHarness } from '../../entities/harness/types';
import {
  GET_NEXT_TASK_STOPPED_ACTION,
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '../../entities/participant';
import { getAgentConfig } from '../agent/get-agent-config';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { acknowledgePendingTask } from '../task/acknowledge-pending-task';
import { findAcknowledgedTaskForRole } from '../task/find-acknowledged-task-for-role';
import { readTask } from '../task/read-task';
import { transitionTask } from '../task/transition-task';
import { startTaskFromReceipt as startFromReceipt } from '../task/start-task-from-receipt';

type ParticipantSnapshot = {
  lastStatus?: string | null;
  lastSeenAction?: string | null;
  lastInFlightTaskId?: Id<'chatroom_tasks'> | null;
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

// ─── Receipt rule (new — checked first) ───────────────────────────────────

async function ruleReceiptNotStarted(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<boolean> {
  const acknowledgedTask = await findAcknowledgedTaskForRole(ctx, args);
  if (!acknowledgedTask || acknowledgedTask.status !== 'acknowledged') return false;
  return startFromReceipt(ctx, args, acknowledgedTask._id);
}

// ─── Existing acknowledged-task rules ──────────────────────────────────────

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
      participant.lastSeenAction === NATIVE_WAITING_ACTION ||
      participant.lastSeenAction === GET_NEXT_TASK_STOPPED_ACTION ||
      participant.lastInFlightTaskId === acknowledgedTask._id);

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

// ─── Existing pending-task rules ──────────────────────────────────────────

async function isReleasedNativePendingResume(
  ctx: MutationCtx,
  pendingTask: Doc<'chatroom_tasks'>
): Promise<boolean> {
  if (!pendingTask.sourceMessageId) return false;
  const sourceMessage = await ctx.db.get('chatroom_messages', pendingTask.sourceMessageId);
  return sourceMessage?.acknowledgedAt != null;
}

async function isRecoveredPendingTask(
  ctx: MutationCtx,
  pendingTask: Doc<'chatroom_tasks'>,
  participant: ParticipantSnapshot
): Promise<boolean> {
  if (isStaleInFlightParticipantStatus(participant.lastStatus)) return true;
  if (participant.lastSeenAction === NATIVE_TASK_INJECTED_ACTION) return true;
  return isReleasedNativePendingResume(ctx, pendingTask);
}

async function ruleRecoveredPending(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: ParticipantSnapshot
): Promise<boolean> {
  const pendingTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_status_assignedTo', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('status', 'pending').eq('assignedTo', args.role)
    )
    .collect();
  const topPending = pendingTasks.sort((a, b) => a.queuePosition - b.queuePosition)[0];
  if (!topPending) return false;

  const agentConfig = await getAgentConfig(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
  const isNative =
    agentConfig.found &&
    agentConfig.config.agentHarness &&
    isNativeHarness(agentConfig.config.agentHarness);

  if (isNative) {
    if (!canResumeNativePendingFromTokenActivity(participant)) return false;
    const isRecovered = await isRecoveredPendingTask(ctx, topPending, participant);
    if (!isRecovered) return false;
    await transitionTask(ctx, topPending._id, 'in_progress', 'resumeFromTokenActivity');
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.inProgress');
    return true;
  }

  if (args.role === 'enhancer') return false;
  if (participant.lastStatus !== 'agent.waiting') return false;

  await acknowledgePendingTask(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    pendingTask: topPending,
  });
  await readTask(ctx, { chatroomId: args.chatroomId, role: args.role, taskId: topPending._id });
  return true;
}

// ─── Token Activity Rules (ordered by priority) ───────────────────────────

const TOKEN_ACTIVITY_RULES: {
  name: string;
  run: (
    ctx: MutationCtx,
    args: { chatroomId: Id<'chatroom_rooms'>; role: string },
    participant: ParticipantSnapshot
  ) => Promise<boolean>;
}[] = [
  { name: 'receipt-not-started', run: ruleReceiptNotStarted },
  { name: 'acknowledged-native', run: maybeStartAcknowledgedTaskFromTokenActivity },
  { name: 'recovered-pending', run: ruleRecoveredPending },
];

/** Starts acknowledged or pending work when harness token activity resumes after agent.waiting. */
export async function startTaskFromTokenActivity(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string },
  participant: ParticipantSnapshot
): Promise<void> {
  for (const rule of TOKEN_ACTIVITY_RULES) {
    if (await rule.run(ctx, args, participant)) return;
  }
}
