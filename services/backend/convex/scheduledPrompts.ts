import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import {
  computeNextRunAt,
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

function validateSchedule(args: {
  scheduleKind: 'interval' | 'daily';
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
}) {
  if (args.scheduleKind === 'interval') {
    if (!args.intervalMinutes || args.intervalMinutes < MIN_INTERVAL_MINUTES) {
      throw new ConvexError({
        code: 'INVALID_SCHEDULE',
        message: `Interval must be at least ${MIN_INTERVAL_MINUTES} minutes`,
      });
    }
  } else {
    if (
      args.hourUTC === undefined ||
      args.minuteUTC === undefined ||
      args.hourUTC < 0 ||
      args.hourUTC > 23 ||
      args.minuteUTC < 0 ||
      args.minuteUTC > 59
    ) {
      throw new ConvexError({
        code: 'INVALID_SCHEDULE',
        message: 'Daily schedule requires valid hourUTC (0-23) and minuteUTC (0-59)',
      });
    }
  }
}

function toScheduleRow(args: {
  scheduleKind: 'interval' | 'daily';
  intervalMinutes?: number;
  hourUTC?: number;
  minuteUTC?: number;
}): ScheduledPromptSchedule {
  if (args.scheduleKind === 'interval') {
    return {
      scheduleKind: 'interval',
      intervalMinutes: args.intervalMinutes ?? 0,
    };
  }
  return {
    scheduleKind: 'daily',
    hourUTC: args.hourUTC ?? 0,
    minuteUTC: args.minuteUTC ?? 0,
  };
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
    scheduleKind: v.union(v.literal('interval'), v.literal('daily')),
    intervalMinutes: v.optional(v.number()),
    hourUTC: v.optional(v.number()),
    minuteUTC: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const trimmed = args.prompt.trim();
    if (!trimmed)
      throw new ConvexError({ code: 'EMPTY_PROMPT', message: 'Prompt cannot be empty' });
    if (trimmed.length > MAX_PROMPT_LENGTH)
      throw new ConvexError({
        code: 'CONTENT_TOO_LONG',
        message: `Prompt must be ${MAX_PROMPT_LENGTH} chars or less`,
      });
    validateSchedule(args);
    const now = Date.now();
    const schedule = toScheduleRow(args);
    const nextRunAt = computeNextRunAt(schedule, now);
    return await ctx.db.insert('chatroom_scheduledPrompts', {
      chatroomId: args.chatroomId,
      name: args.name?.trim() || undefined,
      prompt: trimmed,
      ...schedule,
      disabledReason: undefined,
      isRunnable: true,
      nextRunAt,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    ...SessionIdArg,
    scheduledPromptId: v.id('chatroom_scheduledPrompts'),
    name: v.optional(v.string()),
    prompt: v.optional(v.string()),
    scheduleKind: v.optional(v.union(v.literal('interval'), v.literal('daily'))),
    intervalMinutes: v.optional(v.number()),
    hourUTC: v.optional(v.number()),
    minuteUTC: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await requireScheduledPromptAccess(ctx, args.sessionId, args.scheduledPromptId);
    if (row.disabledReason === 'archive') {
      throw new ConvexError({
        code: 'LIFECYCLE_DISABLED',
        message: 'Cannot update a prompt disabled by archive',
      });
    }
    const now = Date.now();
    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.name !== undefined) patch.name = args.name.trim() || undefined;
    if (args.prompt !== undefined) {
      const trimmed = args.prompt.trim();
      if (!trimmed)
        throw new ConvexError({ code: 'EMPTY_PROMPT', message: 'Prompt cannot be empty' });
      if (trimmed.length > MAX_PROMPT_LENGTH)
        throw new ConvexError({
          code: 'CONTENT_TOO_LONG',
          message: `Prompt must be ${MAX_PROMPT_LENGTH} chars or less`,
        });
      patch.prompt = trimmed;
    }
    let scheduleChanged = false;
    const schedule: {
      scheduleKind: 'interval' | 'daily';
      intervalMinutes?: number;
      hourUTC?: number;
      minuteUTC?: number;
    } = { scheduleKind: row.scheduleKind };
    if (args.scheduleKind !== undefined) {
      schedule.scheduleKind = args.scheduleKind;
      scheduleChanged = true;
    }
    if (args.intervalMinutes !== undefined) {
      schedule.intervalMinutes = args.intervalMinutes;
      scheduleChanged = true;
    }
    if (args.hourUTC !== undefined) {
      schedule.hourUTC = args.hourUTC;
      scheduleChanged = true;
    }
    if (args.minuteUTC !== undefined) {
      schedule.minuteUTC = args.minuteUTC;
      scheduleChanged = true;
    }
    if (scheduleChanged) {
      if (schedule.scheduleKind === 'interval') {
        const fullSchedule = {
          scheduleKind: 'interval' as const,
          intervalMinutes: (args.intervalMinutes ?? row.intervalMinutes) as number,
        };
        validateSchedule(fullSchedule);
        Object.assign(patch, fullSchedule);
        if (row.isRunnable) {
          patch.nextRunAt = computeNextRunAt(fullSchedule, now);
        }
      } else {
        const fullSchedule = {
          scheduleKind: 'daily' as const,
          hourUTC: (args.hourUTC ?? row.hourUTC) as number,
          minuteUTC: (args.minuteUTC ?? row.minuteUTC) as number,
        };
        validateSchedule(fullSchedule);
        Object.assign(patch, fullSchedule);
        if (row.isRunnable) {
          patch.nextRunAt = computeNextRunAt(fullSchedule, now);
        }
      }
    }
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
    await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
      disabledReason: undefined,
      isRunnable: true,
      nextRunAt: computeNextRunAt(schedule, now),
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
    const chatroom = await ctx.db.get('chatroom_rooms', row.chatroomId);
    if (!chatroom || chatroom.status !== 'active') {
      await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
        isRunnable: false,
        nextRunAt: undefined,
        updatedAt: Date.now(),
      });
      return;
    }
    const result = await sendAutomatedUserMessage(ctx, {
      chatroomId: row.chatroomId,
      content: row.prompt,
      sourcePlatform: 'scheduled',
      scheduledPromptId: row._id,
    });
    if (!result.ok) return;

    const now = Date.now();
    const schedule = toScheduleRow(row);
    await ctx.db.patch('chatroom_scheduledPrompts', row._id, {
      lastRunAt: now,
      nextRunAt: computeNextRunAt(schedule, now),
      updatedAt: now,
    });
  },
});
