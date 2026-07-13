import { describe, expect, test } from 'vitest';

import { formatNewContextError } from './format-new-context-error.js';

describe('formatNewContextError', () => {
  test('adds hint when triggerMessageId fails chatroom_messages validation', () => {
    const message = formatNewContextError(
      new Error(
        'ArgumentValidationError: Value does not match validator.\nPath: .triggerMessageId\nValue: "nn7aksw6bpksaxk5jkym9d4zed8ae5b5"\nValidator: v.id("chatroom_messages")'
      )
    );

    expect(message).toContain('triggerMessageId');
    expect(message).toContain('origin-message-id');
    expect(message).toContain('not task-id');
  });

  test('passes through unrelated errors unchanged', () => {
    const message = formatNewContextError(new Error('Permission denied'));
    expect(message).toBe('Permission denied');
  });
});
