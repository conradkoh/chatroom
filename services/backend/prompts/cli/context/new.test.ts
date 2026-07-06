import { describe, expect, test } from 'vitest';

import { contextNewCommand, contextNewHint } from './new';

describe('contextNewCommand', () => {
  test('uses placeholder when trigger message ID is unknown', () => {
    const command = contextNewCommand({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    expect(command).toContain('--trigger-message-id="<userMessageId>"');
    expect(command).toContain("<< 'CHATROOM_CONTEXT_END'");
  });

  test('pre-fills trigger message ID when provided', () => {
    const command = contextNewCommand({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      triggerMessageId: 'pd7bsg0ybba32kfvznhbj4r6s58a0b6r',
    });

    expect(command).toContain('--trigger-message-id="pd7bsg0ybba32kfvznhbj4r6s58a0b6r"');
    expect(command).not.toContain('<userMessageId>');
  });
});

describe('contextNewHint', () => {
  test('clarifies trigger message ID is not the task ID', () => {
    expect(contextNewHint()).toContain('NOT the Task ID');
    expect(contextNewHint()).toContain('Origin Message ID');
  });
});
