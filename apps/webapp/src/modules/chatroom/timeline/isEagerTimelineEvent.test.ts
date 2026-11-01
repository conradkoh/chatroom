import { describe, expect, it } from 'vitest';

import { isEagerTimelineEvent } from './isEagerTimelineEvent';
import type { TimelineEvent, TimelineEventKind } from './types';
import type { Message } from '../types/message';

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'handoff',
    senderRole: 'builder',
    targetRole: 'planner',
    content: 'Body',
    _creationTime: 1_000,
    ...overrides,
  };
}

function event(kind: TimelineEventKind, overrides: Partial<Message> = {}): TimelineEvent {
  return { id: 'event-1', kind, creationTime: 1_000, message: message(overrides) } as TimelineEvent;
}

describe('isEagerTimelineEvent', () => {
  it('treats user messages as eager', () => {
    expect(
      isEagerTimelineEvent(event('user_message', { senderRole: 'user', type: 'message' }))
    ).toBe(true);
  });

  it('treats context dividers as eager', () => {
    expect(isEagerTimelineEvent(event('context', { type: 'new-context' }))).toBe(true);
  });

  it('treats team messages sent by the user as eager', () => {
    expect(
      isEagerTimelineEvent(event('team_message', { senderRole: 'user', type: 'message' }))
    ).toBe(true);
  });

  it('treats handoffs targeting the user as eager', () => {
    expect(
      isEagerTimelineEvent(event('team_message', { senderRole: 'builder', targetRole: 'user' }))
    ).toBe(true);
  });

  it('treats notices targeting the user as eager', () => {
    expect(
      isEagerTimelineEvent(
        event('team_message', { senderRole: 'builder', targetRole: 'user', type: 'notice' })
      )
    ).toBe(true);
  });

  it('collapses agent-to-agent handoffs', () => {
    expect(isEagerTimelineEvent(event('team_message', { type: 'handoff' }))).toBe(false);
  });

  it('collapses agent-to-agent replies', () => {
    expect(isEagerTimelineEvent(event('team_message', { type: 'message' }))).toBe(false);
  });

  it('collapses agent messages without a target role', () => {
    expect(
      isEagerTimelineEvent(event('team_message', { targetRole: undefined, type: 'message' }))
    ).toBe(false);
  });
});
