import { describe, expect, it } from 'vitest';

import { groupChatroomsByRecency } from './groupChatroomsByRecency';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

function localStartOfYesterday(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

describe('groupChatroomsByRecency', () => {
  it('classifies activity into last day, last week, last month, and older buckets', () => {
    const startOfYesterday = localStartOfYesterday(NOW);

    const groups = groupChatroomsByRecency(
      [
        { _id: 'day-edge', _creationTime: startOfYesterday },
        { _id: 'week-edge', _creationTime: NOW - WEEK_MS },
        { _id: 'month-edge', _creationTime: NOW - WEEK_MS - 1 },
        { _id: 'older-edge', _creationTime: NOW - MONTH_MS - 1 },
      ],
      NOW
    );

    expect(groups.lastDay.map((c) => c._id)).toEqual(['day-edge']);
    expect(groups.lastWeek.map((c) => c._id)).toEqual(['week-edge']);
    expect(groups.lastMonth.map((c) => c._id)).toEqual(['month-edge']);
    expect(groups.older.map((c) => c._id)).toEqual(['older-edge']);
  });

  it('groups and sorts chatrooms by most recent activity first within each bucket', () => {
    const startOfYesterday = localStartOfYesterday(NOW);

    const groups = groupChatroomsByRecency(
      [
        {
          _id: 'old',
          _creationTime: NOW - MONTH_MS - 10_000,
          lastActivityAt: NOW - MONTH_MS - 10_000,
        },
        { _id: 'day-new', _creationTime: NOW - 1_000, lastActivityAt: NOW - 1_000 },
        {
          _id: 'day-old',
          _creationTime: startOfYesterday + 1_000,
          lastActivityAt: startOfYesterday + 1_000,
        },
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

    expect(groups.lastDay.map((c) => c._id)).toEqual(['day-new', 'day-old']);
    expect(groups.lastWeek.map((c) => c._id)).toEqual(['week-old']);
    expect(groups.lastMonth.map((c) => c._id)).toEqual(['month']);
    expect(groups.older.map((c) => c._id)).toEqual(['old']);
  });

  it('falls back to creation time when lastActivityAt is missing', () => {
    const groups = groupChatroomsByRecency(
      [{ _id: 'created-recent', _creationTime: NOW - 1_000 }],
      NOW
    );

    expect(groups.lastDay.map((c) => c._id)).toEqual(['created-recent']);
    expect(groups.lastWeek).toEqual([]);
    expect(groups.lastMonth).toEqual([]);
    expect(groups.older).toEqual([]);
  });
});
