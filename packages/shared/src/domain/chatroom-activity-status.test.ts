import { describe, expect, it } from 'vitest';

import {
  ChatroomActivityStatusEnum,
  ChatroomStateEnum,
  deriveChatroomActivityStatus,
  deriveChatroomState,
  isChatroomStopAvailable,
} from './chatroom-activity-status';

describe('chatroom activity status', () => {
  it('derives the allowed high-level states from role read-model statuses', () => {
    expect(deriveChatroomActivityStatus('active', [{ status: 'waiting' }])).toBe(
      ChatroomActivityStatusEnum.active
    );
    expect(deriveChatroomActivityStatus('active', [{ status: 'starting' }])).toBe(
      ChatroomActivityStatusEnum.transitioning
    );
    expect(deriveChatroomActivityStatus('active', [])).toBe(ChatroomActivityStatusEnum.idle);
    expect(deriveChatroomActivityStatus('completed', [{ status: 'working' }])).toBe(
      ChatroomActivityStatusEnum.completed
    );
  });

  it('uses the same projected states for stop eligibility', () => {
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.active)).toBe(true);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.transitioning)).toBe(true);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.idle)).toBe(false);
    expect(isChatroomStopAvailable(ChatroomActivityStatusEnum.completed)).toBe(false);
  });

  it('collapses detailed activity into strict chatroom states', () => {
    expect(deriveChatroomState(ChatroomActivityStatusEnum.working)).toBe(ChatroomStateEnum.active);
    expect(deriveChatroomState(ChatroomActivityStatusEnum.transitioning)).toBe(
      ChatroomStateEnum.attention
    );
    expect(deriveChatroomState(ChatroomActivityStatusEnum.idle)).toBe(ChatroomStateEnum.offline);
  });
});
