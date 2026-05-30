import { describe, it, expect } from 'vitest';

import type { Message } from '../types/message';

import { mapMessageToTimelineEvent } from './mapMessageToTimelineEvent';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'hello',
    _creationTime: 1_000,
    ...overrides,
  };
}

describe('mapMessageToTimelineEvent', () => {
  it('maps user messages to user_message events', () => {
    const message = makeMessage({ senderRole: 'user', type: 'message' });
    const event = mapMessageToTimelineEvent(message);

    expect(event).toEqual({
      id: 'msg-1',
      kind: 'user_message',
      creationTime: 1_000,
      message,
    });
  });

  it('maps new-context messages to context events', () => {
    const message = makeMessage({
      type: 'new-context',
      senderRole: 'system',
      content: 'Context updated',
    });
    const event = mapMessageToTimelineEvent(message);

    expect(event.kind).toBe('context');
    expect(event.id).toBe(message._id);
    expect(event.message).toBe(message);
  });

  it('maps handoffs to team_message events', () => {
    const message = makeMessage({
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'planner',
    });
    const event = mapMessageToTimelineEvent(message);

    expect(event.kind).toBe('team_message');
  });

  it('maps agent replies to team_message events', () => {
    const message = makeMessage({
      type: 'message',
      senderRole: 'planner',
    });
    const event = mapMessageToTimelineEvent(message);

    expect(event.kind).toBe('team_message');
  });

  it('treats user handoffs as team_message (not user_message)', () => {
    const message = makeMessage({
      type: 'handoff',
      senderRole: 'user',
      targetRole: 'planner',
    });
    const event = mapMessageToTimelineEvent(message);

    expect(event.kind).toBe('team_message');
  });

  it('is case-insensitive for user senderRole', () => {
    const message = makeMessage({ senderRole: 'User', type: 'message' });
    expect(mapMessageToTimelineEvent(message).kind).toBe('user_message');
  });
});
