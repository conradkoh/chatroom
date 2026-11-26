/**
 * Pure planner tests for `planQueueReorder`.
 *
 * Every case uses literal ids and literal expected values so the ordering and
 * value-assignment rules are readable without a database.
 */

import { describe, expect, test } from 'vitest';

import { planQueueReorder } from './reorder-queued-message';
import type { Id } from '../../../../convex/_generated/dataModel';

type QueueRow = { _id: Id<'chatroom_messageQueue'>; queuePosition: number };

function row(id: string, queuePosition: number): QueueRow {
  return { _id: id as Id<'chatroom_messageQueue'>, queuePosition };
}

function id(value: string): Id<'chatroom_messageQueue'> {
  return value as Id<'chatroom_messageQueue'>;
}

describe('planQueueReorder', () => {
  test('moving a row down reassigns only the rows whose value changes', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    const plan = planQueueReorder(rows, id('A'), id('C'));

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('B'), queuePosition: 0 },
        { id: id('C'), queuePosition: 1 },
        { id: id('A'), queuePosition: 2 },
      ],
      maxPosition: 3,
    });
  });

  test('moving a row up reassigns the rows it passes', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    const plan = planQueueReorder(rows, id('D'), id('A'));

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('D'), queuePosition: 1 },
        { id: id('B'), queuePosition: 2 },
        { id: id('C'), queuePosition: 3 },
      ],
      maxPosition: 3,
    });
  });

  test('afterId null moves the row to the front', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    const plan = planQueueReorder(rows, id('C'), null);

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('C'), queuePosition: 0 },
        { id: id('A'), queuePosition: 1 },
        { id: id('B'), queuePosition: 2 },
      ],
      maxPosition: 3,
    });
  });

  test('moving a row after the last row places it at the end', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    const plan = planQueueReorder(rows, id('A'), id('D'));

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('B'), queuePosition: 0 },
        { id: id('C'), queuePosition: 1 },
        { id: id('D'), queuePosition: 2 },
        { id: id('A'), queuePosition: 3 },
      ],
      maxPosition: 3,
    });
  });

  test('moving a row after its current predecessor is a no-op', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    expect(planQueueReorder(rows, id('B'), id('A'))).toEqual({ kind: 'noop' });
  });

  test('moving the first row to the front is a no-op', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 2), row('D', 3)];

    expect(planQueueReorder(rows, id('A'), null)).toEqual({ kind: 'noop' });
  });

  test('an unknown moved id is stale', () => {
    const rows = [row('A', 0), row('B', 1)];

    expect(planQueueReorder(rows, id('missing'), null)).toEqual({ kind: 'stale' });
  });

  test('an unknown non-null anchor is stale', () => {
    const rows = [row('A', 0), row('B', 1)];

    expect(planQueueReorder(rows, id('A'), id('missing'))).toEqual({ kind: 'stale' });
  });

  test('sparse values keep the same value multiset', () => {
    const rows = [row('A', 3), row('B', 7), row('C', 12)];

    const plan = planQueueReorder(rows, id('C'), null);

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('C'), queuePosition: 3 },
        { id: id('A'), queuePosition: 7 },
        { id: id('B'), queuePosition: 12 },
      ],
      maxPosition: 12,
    });
  });

  test('duplicate values are repaired into a strictly increasing sequence', () => {
    const rows = [row('A', 0), row('B', 0), row('C', 0)];

    const plan = planQueueReorder(rows, id('C'), null);

    expect(plan).toEqual({
      kind: 'write',
      patches: [
        { id: id('A'), queuePosition: 1 },
        { id: id('B'), queuePosition: 2 },
      ],
      maxPosition: 2,
    });
  });
});
