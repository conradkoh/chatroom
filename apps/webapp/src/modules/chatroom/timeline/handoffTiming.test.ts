import { describe, expect, it } from 'vitest';

import { formatHandoffDuration, getHandoffDurationMs } from './handoffTiming';
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
    ['notice', { ...previous, type: 'notice' }],
    ['message', { ...previous, type: 'message' }],
  ])('counts a %s predecessor', (_label, predecessor) => {
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
    ['message', { ...handoff, type: 'message' }],
    ['notice', { ...handoff, type: 'notice' }],
  ])('omits the duration for a non-handoff %s', (_label, message) => {
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
