import { describe, expect, it } from 'vitest';

import {
  applyVisibleUpdates,
  hasMoreOlderAfterPage,
  inferHasMoreOlder,
  MESSAGE_STORE_LIMIT,
} from './useChatroomMessageStore';
import type { Message } from '../types/message';

describe('hasMoreOlderAfterPage', () => {
  it('returns true for any non-empty page (partial pages still have more)', () => {
    expect(hasMoreOlderAfterPage(5)).toBe(true);
    expect(hasMoreOlderAfterPage(20)).toBe(true);
  });

  it('returns false only for an empty page', () => {
    expect(hasMoreOlderAfterPage(0)).toBe(false);
  });
});

describe('inferHasMoreOlder', () => {
  it('returns true when server reports hasMore', () => {
    expect(inferHasMoreOlder(5, true)).toBe(true);
  });

  it('returns true when window is at cap even if server hasMore is false', () => {
    expect(inferHasMoreOlder(MESSAGE_STORE_LIMIT, false)).toBe(true);
  });

  it('returns false for short windows with no server hasMore', () => {
    expect(inferHasMoreOlder(MESSAGE_STORE_LIMIT - 1, false)).toBe(false);
  });
});

describe('applyVisibleUpdates', () => {
  function makeMsg(
    id: string,
    taskStatus?: string,
    latestProgress?: Message['latestProgress']
  ): Message {
    return {
      _id: id,
      _creationTime: 100,
      type: 'message',
      senderRole: 'user',
      content: 'hello',
      taskStatus: taskStatus as Message['taskStatus'],
      latestProgress,
    } as Message;
  }

  it('patches taskStatus and latestProgress on matching messages by _id', () => {
    const existing = [makeMsg('1', 'in_progress'), makeMsg('2')];
    const updates = [
      { _id: '1', taskStatus: 'completed' as Message['taskStatus'], latestProgress: undefined },
    ];
    const result = applyVisibleUpdates(existing, updates);
    expect(result[0].taskStatus).toBe('completed');
    expect(result[1]).toBe(existing[1]);
  });

  it('returns the same array reference when nothing changed (value-equal progress)', () => {
    const progress = { content: 'working', senderRole: 'builder', _creationTime: 200 };
    const existing = [makeMsg('1', 'in_progress', progress)];
    const updates = [
      {
        _id: '1',
        taskStatus: 'in_progress' as Message['taskStatus'],
        latestProgress: { ...progress },
      },
    ];
    const result = applyVisibleUpdates(existing, updates);
    expect(result).toBe(existing);
  });

  it('ignores updates for ids not in the list', () => {
    const existing = [makeMsg('1')];
    const updates = [
      { _id: '2', taskStatus: 'completed' as Message['taskStatus'], latestProgress: undefined },
    ];
    const result = applyVisibleUpdates(existing, updates);
    expect(result).toBe(existing);
    expect(result[0].taskStatus).toBeUndefined();
  });

  it('returns existing unchanged when updates is empty', () => {
    const existing = [makeMsg('1')];
    const result = applyVisibleUpdates(existing, []);
    expect(result).toBe(existing);
  });
});
