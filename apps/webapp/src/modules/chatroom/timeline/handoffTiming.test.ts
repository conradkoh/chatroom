import { describe, expect, it } from 'vitest';

import { formatHandoffDuration, getHandoffDurationMs } from './handoffTiming';
import type { Message } from '../types/message';

const origin: Message = {
  _id: 'origin',
  type: 'message',
  senderRole: 'user',
  content: 'Start work',
  _creationTime: 1_000,
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
  it('uses the origin lifecycle timestamps', () => {
    expect(getHandoffDurationMs(handoff, new Map([[origin._id, origin]]))).toBe(63_500);
  });

  it('falls back to creation times for legacy records', () => {
    const legacyOrigin = { ...origin, acknowledgedAt: undefined, completedAt: undefined };
    const legacyHandoff = { ...handoff, _creationTime: 6_000 };
    expect(getHandoffDurationMs(legacyHandoff, new Map([[legacyOrigin._id, legacyOrigin]]))).toBe(
      5_000
    );
  });

  it.each([
    ['missing origin', { ...handoff, taskOriginMessageId: 'missing' }],
    ['non-handoff', { ...handoff, type: 'message', taskOriginMessageId: 'origin' }],
  ])('omits timing for %s', (_label, message) => {
    expect(getHandoffDurationMs(message, new Map([[origin._id, origin]]))).toBeUndefined();
  });

  it('omits negative durations', () => {
    const invalidOrigin = { ...origin, acknowledgedAt: 100_000 };
    expect(getHandoffDurationMs(handoff, new Map([[origin._id, invalidOrigin]]))).toBeUndefined();
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
