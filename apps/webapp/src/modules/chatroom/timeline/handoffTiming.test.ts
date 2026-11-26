import { describe, expect, it } from 'vitest';

import {
  formatHandoffDuration,
  formatHandoffDurationTitle,
  getHandoffDurationMs,
  getSlowHandoffThresholdMs,
  isSlowHandoffDuration,
} from './handoffTiming';
import type { Message } from '../types/message';

const previous: Message = {
  _id: 'previous',
  type: 'message',
  senderRole: 'user',
  content: 'Start work',
  _creationTime: 6_000,
  acknowledgedAt: 2_000,
  completedAt: 65_500,
};

const handoff: Message = {
  _id: 'handoff',
  type: 'handoff',
  senderRole: 'builder',
  content: 'Done',
  _creationTime: 66_000,
  taskOriginMessageId: 'origin',
};

describe('handoff timing', () => {
  it('measures elapsed time since the immediately preceding message', () => {
    expect(getHandoffDurationMs(handoff, previous)).toBe(60_000);
  });

  it.each([
    ['notice', { ...previous, type: 'notice' } satisfies Message],
    ['message', { ...previous, type: 'message' } satisfies Message],
  ])('counts a %s predecessor', (_label: string, predecessor: Message) => {
    const earlier = { ...predecessor, _creationTime: 4_000 };
    expect(getHandoffDurationMs(handoff, earlier)).toBe(62_000);
  });

  it('keeps a zero gap between messages created at the same instant', () => {
    expect(getHandoffDurationMs(handoff, { ...previous, _creationTime: 66_000 })).toBe(0);
  });

  it('omits the duration when there is no previous message', () => {
    expect(getHandoffDurationMs(handoff, undefined)).toBeUndefined();
  });

  it('omits negative durations when the previous message is later', () => {
    expect(getHandoffDurationMs(handoff, { ...previous, _creationTime: 100_000 })).toBeUndefined();
  });

  it.each([
    ['message', { ...handoff, type: 'message' } satisfies Message],
    ['notice', { ...handoff, type: 'notice' } satisfies Message],
  ])('omits the duration for a non-handoff %s', (_label: string, message: Message) => {
    expect(getHandoffDurationMs(message, previous)).toBeUndefined();
  });

  it.each([
    [0, '0s'],
    [42_999, '42s'],
    [62_000, '1m 2s'],
    [3_662_000, '1h 1m'],
  ])('formats %s milliseconds as %s', (durationMs, expected) => {
    expect(formatHandoffDuration(durationMs)).toBe(expected);
  });
});

describe('slow handoff threshold', () => {
  it('has no threshold below four defined durations', () => {
    expect(getSlowHandoffThresholdMs([1_000, 1_000, 600_000])).toBeUndefined();
  });

  it('ignores undefined entries when counting samples', () => {
    expect(getSlowHandoffThresholdMs([1_000, undefined, 1_000, 1_000])).toBeUndefined();
  });

  it('flags the screenshot gaps: median 120s, threshold 360s', () => {
    // gaps 60k,120k,420k,480k,60k (the reported conversation)
    expect(getSlowHandoffThresholdMs([60_000, 120_000, 420_000, 480_000, 60_000])).toBe(360_000);
  });

  it('never drops below the 30s floor', () => {
    expect(getSlowHandoffThresholdMs([10_000, 10_000, 10_000, 10_000])).toBe(30_000);
  });

  it('uses the floor when the median is zero', () => {
    expect(getSlowHandoffThresholdMs([0, 0, 0, 0])).toBe(30_000);
  });

  it('scales above the floor when 3x the median is larger', () => {
    expect(getSlowHandoffThresholdMs([20_000, 20_000, 20_000, 20_000])).toBe(60_000);
  });

  it('averages the two middle samples for an even count', () => {
    // median (20k + 40k + 60k + 80k) = 50k -> 150k
    expect(getSlowHandoffThresholdMs([20_000, 40_000, 60_000, 80_000])).toBe(150_000);
  });

  it('keeps the floor for a small even median', () => {
    // median (1k + 2k + 3k + 4k) = 2_500 -> 3x = 7_500, below the floor
    expect(getSlowHandoffThresholdMs([1_000, 2_000, 3_000, 4_000])).toBe(30_000);
  });

  it('is order-independent and does not mutate its input', () => {
    const input = Object.freeze([420_000, 60_000, 480_000, 120_000, 60_000]);
    const copy = [...input];

    expect(getSlowHandoffThresholdMs(input)).toBe(360_000);
    expect(input).toEqual(copy);
  });

  it('gives all-equal gaps a proportional threshold', () => {
    expect(getSlowHandoffThresholdMs([60_000, 60_000, 60_000, 60_000, 60_000])).toBe(180_000);
  });
});

describe('isSlowHandoffDuration', () => {
  it('is inclusive of the threshold', () => {
    expect(isSlowHandoffDuration(60_000, 60_000)).toBe(true);
  });

  it('is false one millisecond below the threshold', () => {
    expect(isSlowHandoffDuration(59_999, 60_000)).toBe(false);
  });

  it('is false without a duration', () => {
    expect(isSlowHandoffDuration(undefined, 60_000)).toBe(false);
  });

  it('is false without a threshold', () => {
    expect(isSlowHandoffDuration(60_000, undefined)).toBe(false);
  });
});

describe('formatHandoffDurationTitle', () => {
  it('states the elapsed time for a normal duration', () => {
    expect(formatHandoffDurationTitle(62_000, false)).toBe('Time since previous message: 1m 2s');
  });

  it('adds the relative qualifier for a slow duration', () => {
    expect(formatHandoffDurationTitle(420_000, true)).toBe(
      'Time since previous message: 7m 0s (much longer than typical in this view)'
    );
  });
});
