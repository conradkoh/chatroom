import { describe, expect, it } from 'vitest';

import { logHistoryInputSchema } from './schemas.js';

describe('logHistoryInputSchema', () => {
  it('preserves timestamp bounds', () => {
    const parsed = logHistoryInputSchema.parse({
      fromTimestamp: 1000,
      toTimestamp: 2000,
      chatroomId: 'room1',
    });
    expect(parsed.fromTimestamp).toBe(1000);
    expect(parsed.toTimestamp).toBe(2000);
  });
  it('omits unknown keys', () => {
    expect(logHistoryInputSchema.parse({ chatroomId: 'room1', afterId: 1, bogus: 'x' })).toEqual({
      chatroomId: 'room1',
      afterId: 1,
    });
  });
});
