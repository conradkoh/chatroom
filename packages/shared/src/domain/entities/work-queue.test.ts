import { describe, expect, it } from 'vitest';

import {
  ACTIVE_QUEUE_TASK_STATUSES,
  TASK_QUEUE_ACTIVITY_BY_STATUS,
  hasActiveWorkQueueTask,
  needsManualQueuePromotion,
  type ActiveWorkQueueTaskCounts,
} from './work-queue';

function emptyActiveCounts(): ActiveWorkQueueTaskCounts {
  return Object.fromEntries(ACTIVE_QUEUE_TASK_STATUSES.map((status) => [status, 0])) as Record<
    (typeof ACTIVE_QUEUE_TASK_STATUSES)[number],
    number
  >;
}

describe('work queue occupancy policy', () => {
  it('derives the active status list from policy classifications', () => {
    const activeStatuses = Object.entries(TASK_QUEUE_ACTIVITY_BY_STATUS)
      .filter(([, occupiesActiveSlot]) => occupiesActiveSlot)
      .map(([status]) => status);

    expect(ACTIVE_QUEUE_TASK_STATUSES).toEqual(activeStatuses);
  });

  it.each(ACTIVE_QUEUE_TASK_STATUSES)('%s work blocks manual promotion', (status) => {
    const counts = { ...emptyActiveCounts(), [status]: 1 };
    expect(hasActiveWorkQueueTask(counts)).toBe(true);
    expect(
      needsManualQueuePromotion({
        hasActiveTask: hasActiveWorkQueueTask(counts),
        hasQueuedMessages: true,
      })
    ).toBe(false);
  });

  it('classifies completed and legacy backlog states as non-active', () => {
    expect(TASK_QUEUE_ACTIVITY_BY_STATUS).toMatchObject({
      completed: false,
      closed: false,
      backlog: false,
      pending_user_review: false,
      backlog_acknowledged: false,
    });
    expect(hasActiveWorkQueueTask(emptyActiveCounts())).toBe(false);
  });

  it('allows manual recovery for an idle room with staged messages only', () => {
    expect(needsManualQueuePromotion({ hasActiveTask: false, hasQueuedMessages: true })).toBe(true);
  });

  it('does not allow promotion for active or empty rooms', () => {
    expect(needsManualQueuePromotion({ hasActiveTask: true, hasQueuedMessages: true })).toBe(false);
    expect(needsManualQueuePromotion({ hasActiveTask: false, hasQueuedMessages: false })).toBe(
      false
    );
  });
});
