import { describe, expect, it } from 'vitest';

import { groupChatroomsByRecency } from './groupChatroomsByRecency';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

describe('groupChatroomsByRecency', () => {
  it('classifies activity into last week, last month, and older buckets', () => {
    const groups = groupChatroomsByRecency(
      [
        { _id: 'week-edge', _creationTime: NOW - WEEK_MS },
        { _id: 'month-edge', _creationTime: NOW - WEEK_MS - 1 },
        { _id: 'older-edge', _creationTime: NOW - MONTH_MS - 1 },
      ],
      NOW
    );

    expect(groups.lastWeek.map((c) => c._id)).toEqual(['week-edge']);
    expect(groups.lastMonth.map((c) => c._id)).toEqual(['month-edge']);
    expect(groups.older.map((c) => c._id)).toEqual(['older-edge']);
  });

  it('groups and sorts chatrooms by most recent activity first within each bucket', () => {
    const groups = groupChatroomsByRecency(
      [
        {
          _id: 'old',
          _creationTime: NOW - MONTH_MS - 10_000,
          lastActivityAt: NOW - MONTH_MS - 10_000,
        },
        { _id: 'week-new', _creationTime: NOW - 1_000, lastActivityAt: NOW - 1_000 },
        {
          _id: 'week-old',
          _creationTime: NOW - WEEK_MS + 1_000,
          lastActivityAt: NOW - WEEK_MS + 1_000,
        },
        {
          _id: 'month',
          _creationTime: NOW - WEEK_MS - 1_000,
          lastActivityAt: NOW - WEEK_MS - 1_000,
        },
      ],
      NOW
    );

    expect(groups.lastWeek.map((c) => c._id)).toEqual(['week-new', 'week-old']);
    expect(groups.lastMonth.map((c) => c._id)).toEqual(['month']);
    expect(groups.older.map((c) => c._id)).toEqual(['old']);
  });

  it('falls back to creation time when lastActivityAt is missing', () => {
    const groups = groupChatroomsByRecency(
      [{ _id: 'created-recent', _creationTime: NOW - 1_000 }],
      NOW
    );

    expect(groups.lastWeek.map((c) => c._id)).toEqual(['created-recent']);
    expect(groups.lastMonth).toEqual([]);
    expect(groups.older).toEqual([]);
  });
});
