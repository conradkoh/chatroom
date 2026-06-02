import { describe, expect, it } from 'vitest';

import {
  hasMoreOlderAfterPage,
  inferHasMoreOlder,
  MESSAGE_STORE_LIMIT,
} from './useChatroomMessageStore';

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
