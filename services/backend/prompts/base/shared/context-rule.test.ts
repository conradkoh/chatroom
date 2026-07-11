import { describe, expect, test } from 'vitest';

import { getContextRuleBlock } from './context-rule';

describe('getContextRuleBlock', () => {
  test('instructs agents to read context before creating and skip duplicate trigger', () => {
    const block = getContextRuleBlock(
      'chatroom context new --chatroom-id="room" --role="planner"',
      'Use the Origin Message ID as trigger.'
    );

    expect(block).toContain('**Before running `context new`, run `context read`');
    expect(block).toContain("same `--trigger-message-id` as this task's Origin Message ID");
    expect(block).toContain('do NOT create another context');
    expect(block).toContain('avoids duplicate timeline dividers');
  });
});
