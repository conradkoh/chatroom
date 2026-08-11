import { describe, expect, test } from 'vitest';

import { getContextRuleBlock } from './context-rule';

describe('getContextRuleBlock', () => {
  test('instructs agents to read context before creating and skip duplicate trigger', () => {
    const block = getContextRuleBlock(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room" --role="planner"',
      'chatroom context new --chatroom-id="room" --role="planner"',
      'Use the Origin Message ID as trigger.'
    );

    expect(block).toContain(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room" --role="planner"'
    );
    expect(block).not.toContain('run `context read`');
    expect(block).toContain('check only whether the pinned context');
    expect(block).toContain('do NOT create another context if it matches');
    expect(block).toContain('staleness warning is present');
    expect(block).toContain('do not act on the stale goal');
  });
});
