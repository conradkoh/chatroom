import { describe, expect, it } from 'vitest';

import { inferHasMoreOlder, MESSAGE_STORE_LIMIT } from './useChatroomMessageStore';

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
