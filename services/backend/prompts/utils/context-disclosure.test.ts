import { describe, expect, test } from 'vitest';

import { getContextReadDisclosureBlock } from './context-disclosure';
import { contextReadCommand } from '../cli/context/read';

describe('context read command', () => {
  test('builds context read with placeholders by default', () => {
    expect(contextReadCommand()).toBe(
      'chatroom context read --chatroom-id="<chatroom-id>" --role="<role>"'
    );
  });

  test('includes cli env prefix and real ids when provided', () => {
    expect(
      contextReadCommand({
        cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
        chatroomId: 'room-123',
        role: 'planner',
      })
    ).toBe(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room-123" --role="planner"'
    );
  });
});

describe('context read disclosure block', () => {
  test('includes checkbox and context read HTML comment', () => {
    const block = getContextReadDisclosureBlock();
    expect(block).toContain(
      'I confirm that I read the current chatroom task context using the command below and that the goal stated in that context has been met'
    );
    expect(block).toContain('Read context before handoff if not already done this task');
    expect(block).toContain('State the context goal and confirm it was achieved');
    expect(block).toContain('chatroom context read');
  });
});
