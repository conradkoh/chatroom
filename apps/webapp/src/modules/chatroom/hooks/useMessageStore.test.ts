import { describe, expect, it } from 'vitest';

import {
  messageStoreReducer,
  initialState,
  deduplicateMessages,
  type MessageStoreState,
} from './useMessageStore';
import type { Message, MessageClassification } from '../types/message';

// ── Test helpers ────────────────────────────────────────────────────────────

function makeMessage(id: string, creationTime: number, taskId?: string): Message {
  return {
    _id: id,
    type: 'message',
    senderRole: 'user',
    content: `Message ${id}`,
    _creationTime: creationTime,
    ...(taskId && { taskId: taskId as any }),
  };
}

// ── deduplicateMessages ─────────────────────────────────────────────────────

describe('deduplicateMessages', () => {
  it('filters out messages with existing IDs', () => {
    const existing = [makeMessage('a', 1), makeMessage('b', 2)];
    const incoming = [makeMessage('b', 2), makeMessage('c', 3)];
    const result = deduplicateMessages(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]!._id).toBe('c');
  });

  it('returns all incoming when no overlap', () => {
    const existing = [makeMessage('a', 1)];
    const incoming = [makeMessage('b', 2), makeMessage('c', 3)];
    const result = deduplicateMessages(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it('returns empty when all incoming are duplicates', () => {
    const existing = [makeMessage('a', 1), makeMessage('b', 2)];
    const incoming = [makeMessage('a', 1), makeMessage('b', 2)];
    const result = deduplicateMessages(existing, incoming);
    expect(result).toHaveLength(0);
  });

  it('handles empty existing array', () => {
    const result = deduplicateMessages([], [makeMessage('a', 1)]);
    expect(result).toHaveLength(1);
  });

  it('handles empty incoming array', () => {
    const result = deduplicateMessages([makeMessage('a', 1)], []);
    expect(result).toHaveLength(0);
  });
});

// ── INITIALIZE ──────────────────────────────────────────────────────────────

describe('messageStoreReducer — INITIALIZE', () => {
  it('initializes with messages and cursors', () => {
    const messages = [makeMessage('a', 100), makeMessage('b', 200)];
    const state = messageStoreReducer(initialState, {
      type: 'INITIALIZE',
      messages,
      cursor: 200,
      hasMore: true,
    });
    expect(state.isInitialized).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(state.oldestCursor).toBe(100);
    expect(state.newestCursor).toBe(200);
    expect(state.hasMoreOlder).toBe(true);
  });

  it('initializes with empty messages', () => {
    const state = messageStoreReducer(initialState, {
      type: 'INITIALIZE',
      messages: [],
      cursor: null,
      hasMore: false,
    });
    expect(state.isInitialized).toBe(true);
    expect(state.messages).toHaveLength(0);
    expect(state.oldestCursor).toBeNull();
    expect(state.hasMoreOlder).toBe(false);
  });

  it('ignores duplicate INITIALIZE calls', () => {
    const first = messageStoreReducer(initialState, {
      type: 'INITIALIZE',
      messages: [makeMessage('a', 100)],
      cursor: 100,
      hasMore: false,
    });
    const second = messageStoreReducer(first, {
      type: 'INITIALIZE',
      messages: [makeMessage('b', 200)],
      cursor: 200,
      hasMore: true,
    });
    // Should return the same state (no re-init)
    expect(second).toBe(first);
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]!._id).toBe('a');
  });
});

// ── APPEND_NEW ──────────────────────────────────────────────────────────────

describe('messageStoreReducer — APPEND_NEW', () => {
  const initialized: MessageStoreState = {
    messages: [makeMessage('a', 100)],
    oldestCursor: 100,
    newestCursor: 100,
    isInitialized: true,
    hasMoreOlder: false,
    isLoadingOlder: false,
    olderQueryCursor: null,
  };

  it('appends new messages and updates newestCursor', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_NEW',
      messages: [makeMessage('b', 200)],
    });
    expect(state.messages).toHaveLength(2);
    expect(state.newestCursor).toBe(200);
  });

  it('deduplicates when appending', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_NEW',
      messages: [makeMessage('a', 100)], // same as existing
    });
    // Should return same state (no change)
    expect(state).toBe(initialized);
  });

  it('returns same state for empty messages', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_NEW',
      messages: [],
    });
    expect(state).toBe(initialized);
  });

  it('allows first message in empty chatroom (newestCursor is null) — trusted path', () => {
    const empty: MessageStoreState = {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(empty, {
      type: 'APPEND_NEW',
      messages: [makeMessage('first', 100)],
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!._id).toBe('first');
    expect(state.newestCursor).toBe(100);
  });

  it('appends all messages without time-guard filtering (trusted path)', () => {
    // APPEND_NEW is the trusted path — it does NOT filter by time.
    // Even messages older than newestCursor are accepted.
    const afterPurge: MessageStoreState = {
      messages: [makeMessage('d', 400), makeMessage('e', 500)],
      oldestCursor: 400,
      newestCursor: 500,
      isInitialized: true,
      hasMoreOlder: true,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(afterPurge, {
      type: 'APPEND_NEW',
      messages: [makeMessage('a', 100), makeMessage('f', 600)],
    });
    // All non-duplicate messages are appended, even 'a' which is older
    expect(state.messages).toHaveLength(4);
    expect(state.messages.map((m) => m._id)).toEqual(['d', 'e', 'a', 'f']);
    expect(state.newestCursor).toBe(600);
  });
});

// ── APPEND_DELTA ──────────────────────────────────────────────────────────────

describe('messageStoreReducer — APPEND_DELTA', () => {
  const initialized: MessageStoreState = {
    messages: [makeMessage('a', 100)],
    oldestCursor: 100,
    newestCursor: 100,
    isInitialized: true,
    hasMoreOlder: false,
    isLoadingOlder: false,
    olderQueryCursor: null,
  };

  it('appends new messages and updates newestCursor', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_DELTA',
      messages: [makeMessage('b', 200)],
    });
    expect(state.messages).toHaveLength(2);
    expect(state.newestCursor).toBe(200);
  });

  it('deduplicates when appending', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_DELTA',
      messages: [makeMessage('a', 100)], // same as existing
    });
    // Should return same state (no change)
    expect(state).toBe(initialized);
  });

  it('returns same state for empty messages', () => {
    const state = messageStoreReducer(initialized, {
      type: 'APPEND_DELTA',
      messages: [],
    });
    expect(state).toBe(initialized);
  });

  it('rejects messages older than newestCursor (post-purge refetch guard)', () => {
    const afterPurge: MessageStoreState = {
      messages: [makeMessage('d', 400), makeMessage('e', 500)],
      oldestCursor: 400,
      newestCursor: 500,
      isInitialized: true,
      hasMoreOlder: true,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(afterPurge, {
      type: 'APPEND_DELTA',
      messages: [makeMessage('a', 100), makeMessage('b', 200), makeMessage('f', 600)],
    });
    expect(state.messages).toHaveLength(3);
    expect(state.messages.map((m) => m._id)).toEqual(['d', 'e', 'f']);
    expect(state.newestCursor).toBe(600);
  });

  it('rejects all messages when newestCursor is null (uninitialized store)', () => {
    // APPEND_DELTA requires newestCursor to be set. If null (shouldn't happen
    // in practice since the tail subscription is skipped until initialization),
    // all messages are rejected — no fallback to invalid behavior.
    const empty: MessageStoreState = {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(empty, {
      type: 'APPEND_DELTA',
      messages: [makeMessage('first', 100)],
    });
    // All messages rejected — no fallback to accepting everything
    expect(state.messages).toHaveLength(0);
  });
});

// ── PREPEND_OLDER ───────────────────────────────────────────────────────────

describe('messageStoreReducer — PREPEND_OLDER', () => {
  const initialized: MessageStoreState = {
    messages: [makeMessage('c', 300)],
    oldestCursor: 300,
    newestCursor: 300,
    isInitialized: true,
    hasMoreOlder: true,
    isLoadingOlder: true,
    olderQueryCursor: 300,
  };

  it('prepends older messages and updates oldestCursor', () => {
    const state = messageStoreReducer(initialized, {
      type: 'PREPEND_OLDER',
      messages: [makeMessage('a', 100), makeMessage('b', 200)],
      hasMore: true,
    });
    expect(state.messages).toHaveLength(3);
    expect(state.messages[0]!._id).toBe('a');
    expect(state.oldestCursor).toBe(100);
    expect(state.isLoadingOlder).toBe(false);
    expect(state.olderQueryCursor).toBeNull();
  });

  it('handles empty prepend (no more messages)', () => {
    const state = messageStoreReducer(initialized, {
      type: 'PREPEND_OLDER',
      messages: [],
      hasMore: false,
    });
    expect(state.messages).toHaveLength(1);
    expect(state.hasMoreOlder).toBe(false);
    expect(state.isLoadingOlder).toBe(false);
  });

  it('deduplicates when prepending', () => {
    const state = messageStoreReducer(initialized, {
      type: 'PREPEND_OLDER',
      messages: [makeMessage('c', 300)], // duplicate
      hasMore: false,
    });
    expect(state.messages).toHaveLength(1);
  });
});

// ── PURGE_OLD ───────────────────────────────────────────────────────────────

describe('messageStoreReducer — PURGE_OLD', () => {
  const withMany: MessageStoreState = {
    messages: Array.from({ length: 100 }, (_, i) => makeMessage(`m${i}`, i * 10)),
    oldestCursor: 0,
    newestCursor: 990,
    isInitialized: true,
    hasMoreOlder: false,
    isLoadingOlder: false,
    olderQueryCursor: null,
  };

  it('purges messages above the viewport when over threshold', () => {
    // viewportTopIndex = 80, keepAboveCount = 50
    // purgeCount = 80 - 50 = 30 → remove first 30 messages
    const state = messageStoreReducer(withMany, {
      type: 'PURGE_OLD',
      keepAboveCount: 50,
      viewportTopIndex: 80,
    });
    expect(state.messages).toHaveLength(70);
    expect(state.messages[0]!._id).toBe('m30');
    expect(state.hasMoreOlder).toBe(true); // purged = re-loadable
  });

  it('does not purge when under threshold', () => {
    const state = messageStoreReducer(withMany, {
      type: 'PURGE_OLD',
      keepAboveCount: 50,
      viewportTopIndex: 30, // 30 - 50 = -20, no purge
    });
    expect(state).toBe(withMany); // no change
  });
});

// ── REQUEST_OLDER ───────────────────────────────────────────────────────────

describe('messageStoreReducer — REQUEST_OLDER', () => {
  it('sets isLoadingOlder and olderQueryCursor', () => {
    const base: MessageStoreState = {
      messages: [makeMessage('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: true,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(base, { type: 'REQUEST_OLDER' });
    expect(state.isLoadingOlder).toBe(true);
    expect(state.olderQueryCursor).toBe(100);
  });

  it('no-ops when already loading', () => {
    const loading: MessageStoreState = {
      messages: [makeMessage('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: true,
      isLoadingOlder: true,
      olderQueryCursor: 100,
    };
    const state = messageStoreReducer(loading, { type: 'REQUEST_OLDER' });
    expect(state).toBe(loading);
  });

  it('no-ops when no more older messages', () => {
    const noMore: MessageStoreState = {
      messages: [makeMessage('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(noMore, { type: 'REQUEST_OLDER' });
    expect(state).toBe(noMore);
  });
});

// ── RESET ───────────────────────────────────────────────────────────────────

describe('messageStoreReducer — RESET', () => {
  it('resets to initial state', () => {
    const populated: MessageStoreState = {
      messages: [makeMessage('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(populated, { type: 'RESET' });
    expect(state).toEqual(initialState);
  });
});

// ── UPDATE_TASK_STATUS ──────────────────────────────────────────────────────

describe('messageStoreReducer — UPDATE_TASK_STATUS', () => {
  it('updates taskStatus on matching messages', () => {
    const withTask: MessageStoreState = {
      messages: [
        makeMessage('a', 100, 'task1'),
        makeMessage('b', 200, 'task2'),
        makeMessage('c', 300), // no taskId
      ],
      oldestCursor: 100,
      newestCursor: 300,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(withTask, {
      type: 'UPDATE_TASK_STATUS',
      taskId: 'task1',
      newStatus: 'in_progress',
    });
    expect(state.messages).toHaveLength(3);
    expect(state.messages[0]!.taskStatus).toBe('in_progress');
    expect(state.messages[1]!.taskStatus).toBeUndefined();
    expect(state.messages[2]!.taskStatus).toBeUndefined();
  });

  it('updates multiple messages with the same taskId', () => {
    const withTask: MessageStoreState = {
      messages: [
        makeMessage('a', 100, 'task1'),
        makeMessage('b', 200, 'task2'),
        makeMessage('c', 300, 'task1'),
      ],
      oldestCursor: 100,
      newestCursor: 300,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(withTask, {
      type: 'UPDATE_TASK_STATUS',
      taskId: 'task1',
      newStatus: 'acknowledged',
    });
    expect(state.messages[0]!.taskStatus).toBe('acknowledged');
    expect(state.messages[1]!.taskStatus).toBeUndefined();
    expect(state.messages[2]!.taskStatus).toBe('acknowledged');
  });

  it('handles taskId not found in messages', () => {
    const withTask: MessageStoreState = {
      messages: [makeMessage('a', 100, 'task1')],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(withTask, {
      type: 'UPDATE_TASK_STATUS',
      taskId: 'nonexistent',
      newStatus: 'completed',
    });
    // Should return same state (no change)
    expect(state.messages[0]!.taskStatus).toBeUndefined();
  });

  it('handles empty messages array', () => {
    const empty: MessageStoreState = {
      messages: [],
      oldestCursor: null,
      newestCursor: null,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(empty, {
      type: 'UPDATE_TASK_STATUS',
      taskId: 'task1',
      newStatus: 'in_progress',
    });
    expect(state.messages).toHaveLength(0);
  });
});

// ── MERGE_MESSAGE_METADATA ────────────────────────────────────────────────────

function makeMessageWithMetadata(
  id: string,
  creationTime: number,
  metadata?: {
    classification?: MessageClassification;
    featureTitle?: string;
    featureDescription?: string;
    featureTechSpecs?: string;
    taskStatus?: Message['taskStatus'];
  }
): Message {
  return {
    _id: id,
    type: 'message',
    senderRole: 'user',
    content: `Message ${id}`,
    _creationTime: creationTime,
    ...metadata,
  };
}

describe('messageStoreReducer — MERGE_MESSAGE_METADATA', () => {
  it('merges classification into existing message', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [makeMessageWithMetadata('a', 100, { classification: 'question' })],
    });
    expect(state.messages[0]!.classification).toBe('question');
  });

  it('merges feature metadata into existing message', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [
        makeMessageWithMetadata('a', 100, {
          classification: 'new_feature',
          featureTitle: 'Test Feature',
          featureDescription: 'A test description',
          featureTechSpecs: 'Some specs',
        }),
      ],
    });
    expect(state.messages[0]!.classification).toBe('new_feature');
    expect(state.messages[0]!.featureTitle).toBe('Test Feature');
    expect(state.messages[0]!.featureDescription).toBe('A test description');
    expect(state.messages[0]!.featureTechSpecs).toBe('Some specs');
  });

  it('merges taskStatus into existing message', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [makeMessageWithMetadata('a', 100, { taskStatus: 'completed' })],
    });
    expect(state.messages[0]!.taskStatus).toBe('completed');
  });

  it('ignores messages not in the store', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [makeMessageWithMetadata('b', 200, { classification: 'question' })],
    });
    // No changes since message 'b' is not in the store
    expect(state.messages[0]!._id).toBe('a');
    expect(state.messages[0]!.classification).toBeUndefined();
  });

  it('returns same state reference when no changes', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100, { classification: 'question' })],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [makeMessageWithMetadata('a', 100, { classification: 'question' })],
    });
    // Same classification, no change - should return same state
    expect(state).toBe(initial);
  });

  it('handles multiple messages', () => {
    const initial: MessageStoreState = {
      messages: [
        makeMessageWithMetadata('a', 100),
        makeMessageWithMetadata('b', 200),
        makeMessageWithMetadata('c', 300),
      ],
      oldestCursor: 100,
      newestCursor: 300,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [
        makeMessageWithMetadata('a', 100, { classification: 'question' }),
        makeMessageWithMetadata('c', 300, { classification: 'new_feature', featureTitle: 'Test' }),
      ],
    });
    expect(state.messages[0]!.classification).toBe('question');
    expect(state.messages[1]!.classification).toBeUndefined(); // 'b' not in merge list
    expect(state.messages[2]!.classification).toBe('new_feature');
    expect(state.messages[2]!.featureTitle).toBe('Test');
  });

  it('handles empty incoming messages', () => {
    const initial: MessageStoreState = {
      messages: [makeMessageWithMetadata('a', 100)],
      oldestCursor: 100,
      newestCursor: 100,
      isInitialized: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      olderQueryCursor: null,
    };
    const state = messageStoreReducer(initial, {
      type: 'MERGE_MESSAGE_METADATA',
      messages: [],
    });
    // No changes
    expect(state).toBe(initial);
  });
});
