import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { omitUndefined } from './lib/omitUndefined';
import {
  computeNextRunAt,
  computeNextRunAtForEnable,
  type ScheduledPromptSchedule,
} from '../src/domain/usecase/chatroom/compute-next-run-at';
import { sendAutomatedUserMessage } from '../src/domain/usecase/chatroom/send-automated-user-message';

const MAX_PROMPT_LENGTH = 10_000;
const MIN_INTERVAL_MINUTES = 1;
const SCAN_BATCH_SIZE = 10;

// ─── Access helper ───

async function requireScheduledPromptAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  scheduledPromptId: Id<'chatroom_scheduledPrompts'>
) {
  const row = await ctx.db.get('chatroom_scheduledPrompts', scheduledPromptId);
  if (!row) throw new ConvexError({ code: 'NOT_FOUND', message: 'Scheduled prompt not found' });
  await requireChatroomAccess(ctx, sessionId, row.chatroomId);
  return row;
}

// ─── Validation helpers ───

const scheduleKindValidator = v.union(v.literal('interval'), v.literal('daily'), v.literal('once'));

type ScheduleInput = {
  scheduleKind: 'interval' | 'daily' | 'once';
  intervalMinutes?: number | undefined;
  hourUTC?: number | undefined;
  minuteUTC?: number | undefined;
  runAt?: number | undefined;
};

/** Fields an update may change on a schedule. Absent means "keep current". */
type ScheduleUpdateInput = {
  scheduleKind?: 'interval' | 'daily' | 'once' | undefined;
  intervalMinutes?: number | undefined;
  hourUTC?: number | undefined;
  minuteUTC?: number | undefined;
  runAt?: number | undefined;
};

function assertValidInterval(intervalMinutes: number | undefined): void {
  if (!intervalMinutes || intervalMinutes < MIN_INTERVAL_MINUTES) {
    throw new ConvexError({
      code: 'INVALID_SCHEDULE',
      message: `Interval must be at least ${MIN_INTERVAL_MINUTES} minutes`,
    });
  }
}

function isValidHour(hourUTC: number | undefined): boolean {
  return hourUTC !== undefined && hourUTC >= 0 && hourUTC <= 23;
}

function isValidMinute(minuteUTC: number | undefined): boolean {
  return minuteUTC !== undefined && minuteUTC >= 0 && minuteUTC <= 59;
}

function assertValidDaily(hourUTC: number | undefined, minuteUTC: number | undefined): void {
  if (!isValidHour(hourUTC) || !isValidMinute(minuteUTC)) {
    throw new ConvexError({
      code: 'INVALID_SCHEDULE',
      message: 'Daily schedule requires valid hourUTC (0-23) and minuteUTC (0-59)',
    });
  }
}

function assertValidOnce(runAt: number | undefined, nowMs: number): void {
  if (runAt === undefined || !Number.isFinite(runAt) || runAt <= nowMs) {
    throw new ConvexError({
      code: 'INVALID_SCHEDULE',
      message: 'One-time schedule requires a time in the future',
    });
  }
}

function assertValidPromptContent(trimmed: string): void {
  if (!trimmed) {
    throw new ConvexError({ code: 'EMPTY_PROMPT', message: 'Prompt cannot be empty' });
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new ConvexError({
      code: 'CONTENT_TOO_LONG',
      message: `Prompt must be ${MAX_PROMPT_LENGTH} chars or less`,
    });
  }
}

function validateSchedule(args: ScheduleInput, nowMs: number): void {
  switch (args.scheduleKind) {
    case 'interval':
      return assertValidInterval(args.intervalMinutes);
    case 'daily':
      return assertValidDaily(args.hourUTC, args.minuteUTC);
    case 'once':
      return assertValidOnce(args.runAt, nowMs);
    default: {
      const never: never = args.scheduleKind;
      throw new Error(`Unknown scheduleKind ${String(never)}`);
    }
  }
}

function toScheduleRow(args: ScheduleInput): ScheduledPromptSchedule {
  if (args.scheduleKind === 'interval') {
    return {
      scheduleKind: 'interval',
      intervalMinutes: args.intervalMinutes ?? 0,
    };
  }
  if (args.scheduleKind === 'daily') {
    return {
      scheduleKind: 'daily',
      hourUTC: args.hourUTC ?? 0,
      minuteUTC: args.minuteUTC ?? 0,
    };
  }
  return { scheduleKind: 'once', runAt: args.runAt ?? 0 };
}

/**
 * A one-time prompt that already fired (or failed to fire) is terminal history.
 * It can never be edited or re-armed; only `remove` and reads remain available.
 */
function assertNotFinished(row: Doc<'chatroom_scheduledPrompts'>): void {
  if (row.disabledReason === 'completed' || row.disabledReason === 'failed') {
    throw new ConvexError({
      code: 'SCHEDULE_FINISHED',
      message: 'This one-time prompt has already run and cannot be changed',
    });
  }
}

/** Build the schedule fields for a one-time update; empty when the time is unchanged. */
function buildOnceSchedulePatch(
  row: Doc<'chatroom_scheduledPrompts'>,
  runAt: number | undefined,
  now: number
): Record<string, unknown> {
  const nextRunAt = runAt ?? row.runAt;
  // The edit form always resends runAt. Only re-validate and re-arm when the
  // time (or the kind) actually changed, so renaming a row whose time has
  // passed but which the cron has not fired yet still succeeds.
  const timeChanged = row.scheduleKind !== 'once' || nextRunAt !== row.runAt;
  if (!timeChanged) return {};
  validateSchedule({ scheduleKind: 'once', runAt: nextRunAt }, now);
  return {
    scheduleKind: 'once',
    runAt: nextRunAt,
    intervalMinutes: undefined,
    hourUTC: undefined,
    minuteUTC: undefined,
    ...(row.isRunnable ? { nextRunAt } : {}),
  };
}

/** Build the schedule fields for an interval/daily update; empty when nothing changed. */
function buildRecurringSchedulePatch(
  row: Doc<'chatroom_scheduledPrompts'>,
  args: ScheduleUpdateInput,
  scheduleKind: 'interval' | 'daily',
  now: number
): Record<string, unknown> {
  const scheduleInput: ScheduleInput = {
    scheduleKind,
    intervalMinutes: args.intervalMinutes ?? row.intervalMinutes,
    hourUTC: args.hourUTC ?? row.hourUTC,
    minuteUTC: args.minuteUTC ?? row.minuteUTC,
  };
  validateSchedule(scheduleInput, now);
  const fullSchedule = toScheduleRow(scheduleInput);
  if (fullSchedule.scheduleKind === 'once') {
    throw new Error('Invariant: a recurring schedule update produced a one-time schedule');
  }
  return {
    ...fullSchedule,
    runAt: undefined,
    ...(row.isRunnable ? { nextRunAt: computeNextRunAtForEnable(fullSchedule, now) } : {}),
  };
}

function buildContentPatch(
  name: string | undefined,
  prompt: string | undefined
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name.trim() || undefined;
  if (prompt === undefined) return patch;
  const trimmed = prompt.trim();
  assertValidPromptContent(trimmed);
  patch.prompt = trimmed;
  return patch;
}

function isRecurringScheduleChanged(args: ScheduleUpdateInput): boolean {
  return (
    args.scheduleKind !== undefined ||
    args.intervalMinutes !== undefined ||
    args.hourUTC !== undefined ||
    args.minuteUTC !== undefined
  );
}

function buildSchedulePatch(
  row: Doc<'chatroom_scheduledPrompts'>,
  args: ScheduleUpdateInput,
  now: number
): Record<string, unknown> {
  const kind = args.scheduleKind ?? row.scheduleKind;
  if (kind === 'once') return buildOnceSchedulePatch(row, args.runAt, now);
  if (!isRecurringScheduleChanged(args)) return {};
  return buildRecurringSchedulePatch(row, args, kind, now);
}

// ─── Queries ───

export const list = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return await ctx.db
      .query('chatroom_scheduledPrompts')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

export const get = query({
  args: { ...SessionIdArg, scheduledPromptId: v.id('chatroom_scheduledPrompts') },
  handler: async (ctx, args) => {
    return await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
  },
});

export const listTriggeredMessages = query({
  args: {
    ...SessionIdArg,
    scheduledPromptId: v.id('chatroom_scheduledPrompts'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
    const limit = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query('chatroom_messages')
      .withIndex('by_scheduledPromptId', (q) => q.eq('scheduledPromptId', row._id))
      .order('desc')
      .take(limit);
  },
});

// ─── Mutations ───

export const create = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    name: v.optional(v.string()),
    prompt: v.string(),
    scheduleKind: scheduleKindValidator,
    intervalMinutes: v.optional(v.number()),
    hourUTC: v.optional(v.number()),
    minuteUTC: v.optional(v.number()),
    runAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const trimmed = args.prompt.trim();
    assertValidPromptContent(trimmed);
    const now = Date.now();
    validateSchedule(args, now);
    const schedule = toScheduleRow(args);
    const nextRunAt = computeNextRunAtForEnable(schedule, now);
    return await ctx.db.insert(
      'chatroom_scheduledPrompts',
      omitUndefined({
        chatroomId: args.chatroomId,
        ...((args.name?.trim() || undefined) !== undefined
          ? { name: args.name?.trim() || undefined }
          : {}),
        prompt: trimmed,
        ...schedule,
        isRunnable: true,
        nextRunAt,
        createdBy: session.userId,
        createdAt: now,
        updatedAt: now,
      })
    );
  },
});

export const update = mutation({
  args: {
    ...SessionIdArg,
    scheduledPromptId: v.id('chatroom_scheduledPrompts'),
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    scheduleKind: v.optional(scheduleKindValidator),
    intervalMinutes: v.optional(v.number()),
    hourUTC: v.optional(v.number()),
    minuteUTC: v.optional(v.number()),
    runAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
    if (row.disabledReason === 'archive') {
      throw new ConvexError({
        code: 'LIFECYCLE_DISABLED',
        message: 'Cannot update a prompt disabled by archive',
      });
    }
    assertNotFinished(row);
    const now = Date.now();
    const patch: Record<string, unknown> = {
      updatedAt: now,
      ...buildContentPatch(args.name, args.prompt),
      ...buildSchedulePatch(row, args, now),
    };
    await ctx.db.patch('chatroom_scheduledPrompts', row._id, patch);
  },
});

export const setEnabled = mutation({
  args: {
    ...SessionIdArg,
    scheduledPromptId: v.id('chatroom_scheduledPrompts'),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
    if (row.disabledReason === 'archive') {
      throw new ConvexError({
        code: 'LIFECYCLE_DISABLED',
        message: 'Cannot enable a prompt disabled by archive',
      });
    }
    assertNotFinished(row);
    const now = Date.now();
    if (!args.enabled) {
      await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
        disabledReason: 'user',
        isRunnable: false,
        nextRunAt: undefined,
        updatedAt: now,
      });
      return;
    }
    const schedule = toScheduleRow(row);
    if (schedule.scheduleKind === 'once' && schedule.runAt <= now) {
      throw new ConvexError({
        code: 'INVALID_SCHEDULE',
        message: 'Scheduled time has passed — edit the prompt to pick a new time',
      });
    }
    const anchor = schedule.scheduleKind === 'interval' ? row.lastRunAt : undefined;
    await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
      disabledReason: undefined,
      isRunnable: true,
      nextRunAt: computeNextRunAtForEnable(schedule, now, anchor),
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: {
    ...SessionIdArg,
    scheduledPromptId: v.id('chatroom_scheduledPrompts'),
  },
  handler: async (ctx, args) => {
    const row = await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
    await ctx.db.delete('chatroom_scheduledPrompts', row._id);
  },
});

// ─── Internal cron ───

export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('chatroom_scheduledPrompts')
      .withIndex('by_isRunnable_nextRunAt', (q) => q.eq('isRunnable', true).lte('nextRunAt', now))
      .take(SCAN_BATCH_SIZE);

    for (const row of due) {
      await ctx.scheduler.runAfter(0, internal.scheduledPrompts.fireOne, {
        scheduledPromptId: row._id,
      });
    }
    if (due.length === SCAN_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.scheduledPrompts.runDue);
    }
  },
});

/**
 * Stop a prompt from firing. Recurring rows are left re-enableable; one-time
 * rows can also be marked terminal (`failed`).
 */
async function disablePrompt(
  ctx: MutationCtx,
  row: Doc<'chatroom_scheduledPrompts'>,
  failed: boolean
): Promise<void> {
  await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
    isRunnable: false,
    nextRunAt: undefined,
    ...(failed ? { disabledReason: 'failed' as const } : {}),
    updatedAt: Date.now(),
  });
}

/** Record a successful fire: one-time rows complete; recurring rows re-arm. */
async function recordFire(ctx: MutationCtx, row: Doc<'chatroom_scheduledPrompts'>): Promise<void> {
  const now = Date.now();
  const schedule = toScheduleRow(row);
  if (schedule.scheduleKind === 'once') {
    await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
      lastRunAt: now,
      nextRunAt: undefined,
      isRunnable: false,
      disabledReason: 'completed',
      updatedAt: now,
    });
    return;
  }
  await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
    lastRunAt: now,
    nextRunAt: computeNextRunAt(schedule, now, row.nextRunAt),
    updatedAt: now,
  });
}

export const fireOne = internalMutation({
  args: { scheduledPromptId: v.id('chatroom_scheduledPrompts') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('chatroom_scheduledPrompts', args.scheduledPromptId);
    if (
      !row ||
      !row.isRunnable ||
      row.disabledReason !== undefined ||
      !row.nextRunAt ||
      row.nextRunAt > Date.now()
    ) {
      return;
    }
    const isOnce = row.scheduleKind === 'once';
    const chatroom = await ctx.db.get('chatroom_rooms', row.chatroomId);
    if (!chatroom || chatroom.status !== 'active') {
      await disablePrompt(ctx, row, isOnce);
      return;
    }
    const result = await sendAutomatedUserMessage(ctx, {
      chatroomId: row.chatroomId,
      content: row.prompt,
      sourcePlatform: 'scheduled',
      scheduledPromptId: row._id,
      startInNewSession: true,
      ...(chatroom.ownerId ? { userId: chatroom.ownerId } : {}),
    });
    if (!result.ok) {
      // A one-time row gets exactly one attempt: a failed send is terminal.
      // Recurring rows stay live and retry on the next tick.
      if (isOnce) await disablePrompt(ctx, row, true);
      return;
    }

    // Wake offline agents, matching the manual user-message path in messages.ts.
    await ctx.scheduler.runAfter(0, internal.agents.startNonRunningAgentsForChatroom, {
      chatroomId: row.chatroomId,
    });

    await recordFire(ctx, row);
  },
});
