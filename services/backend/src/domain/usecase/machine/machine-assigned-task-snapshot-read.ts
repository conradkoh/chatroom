/**
 * Indexed reads from machine assigned-task snapshot projection.
 */

import { parseAssignedTaskSignal } from './assigned-task-monitor-contract';
import { presenceKeyAfterTimestamp } from './assigned-tasks-revision';
import type {
  AssignedTaskView,
  GetAssignedTaskForActionInput,
  ListMachineAssignedTaskSnapshotsResult,
  MachineAssignedTasksInput,
  SubscribeAssignedTaskPresenceInput,
  SubscribeAssignedTaskPresenceResult,
  SubscribeAssignedTaskSignalsInput,
  SubscribeAssignedTaskSignalsResult,
} from './assigned-tasks-types';
import {
  assertMachineSnapshotAccess,
  snapshotDocToPresenceSignal,
  snapshotDocToSignal,
  snapshotDocToView,
} from './machine-assigned-task-snapshot-sync';
import type { QueryCtx } from '../../../../convex/_generated/server';

type SnapshotFeedPage<TItem, THigh> = {
  items: TItem[];
  high: THigh | null;
  hasMore: boolean;
};

const EMPTY_PRESENCE_RESULT: SubscribeAssignedTaskPresenceResult = {
  items: [],
  highPresenceAt: null,
  highPresenceKey: null,
  hasMore: false,
};

function sliceSnapshotFeedPage<TDoc, TItem, THigh>(
  page: TDoc[],
  limit: number,
  toItem: (doc: TDoc) => TItem,
  pickHigh: (item: TItem) => THigh
): SnapshotFeedPage<TItem, THigh> {
  const hasMore = page.length > limit;
  const items = page.slice(0, limit).map(toItem);
  const lastItem = items.at(-1);
  return {
    items,
    high: lastItem ? pickHigh(lastItem) : null,
    hasMore,
  };
}

function resolvePresenceAfterKey(input: SubscribeAssignedTaskPresenceInput): string {
  return input.afterPresenceKey ?? presenceKeyAfterTimestamp(input.afterPresenceAt ?? 0);
}

function presenceFeedToResult(
  feed: SnapshotFeedPage<ReturnType<typeof snapshotDocToPresenceSignal>, string>
): SubscribeAssignedTaskPresenceResult {
  return {
    items: feed.items,
    highPresenceAt: feed.items.at(-1)?.presenceUpdatedAt ?? null,
    highPresenceKey: feed.high,
    hasMore: feed.hasMore,
  };
}

export async function listMachineAssignedTaskSnapshotsForMachine(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput
): Promise<ListMachineAssignedTaskSnapshotsResult> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return { tasks: [] };

  const docs = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .collect();

  return { tasks: docs.map(snapshotDocToView) };
}

export async function subscribeAssignedTaskSignalsFromSnapshots(
  ctx: QueryCtx,
  input: SubscribeAssignedTaskSignalsInput
): Promise<SubscribeAssignedTaskSignalsResult> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return { items: [], highKey: null, hasMore: false };

  const afterKey = input.afterKey ?? '';
  const page = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId_revisionKey', (q) =>
      q.eq('machineId', input.machineId).gt('revisionKey', afterKey)
    )
    .order('asc')
    .take(input.limit + 1);

  const feed = sliceSnapshotFeedPage(
    page,
    input.limit,
    (doc) => parseAssignedTaskSignal(snapshotDocToSignal(doc)),
    (item) => item.revisionKey
  );
  return {
    items: feed.items,
    highKey: feed.high,
    hasMore: feed.hasMore,
  };
}

export async function subscribeAssignedTaskPresenceFromSnapshots(
  ctx: QueryCtx,
  input: SubscribeAssignedTaskPresenceInput
): Promise<SubscribeAssignedTaskPresenceResult> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return EMPTY_PRESENCE_RESULT;

  const page = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId_presenceKey', (q) =>
      q.eq('machineId', input.machineId).gt('presenceKey', resolvePresenceAfterKey(input))
    )
    .order('asc')
    .take(input.limit + 1);

  const feed = sliceSnapshotFeedPage(
    page,
    input.limit,
    snapshotDocToPresenceSignal,
    (item) => item.presenceKey
  );
  return presenceFeedToResult(feed);
}

export async function getAssignedTaskForActionFromSnapshots(
  ctx: QueryCtx,
  input: GetAssignedTaskForActionInput
): Promise<AssignedTaskView | null> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return null;

  const snapshot = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId_taskId_role', (q) =>
      q.eq('machineId', input.machineId).eq('taskId', input.taskId).eq('role', input.role)
    )
    .unique();
  if (!snapshot) return null;

  const task = await ctx.db.get('chatroom_tasks', input.taskId);
  if (!task) return null;

  return {
    ...snapshotDocToView(snapshot),
    taskContent: task.content,
  };
}
