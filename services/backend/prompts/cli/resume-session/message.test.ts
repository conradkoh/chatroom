import { describe, expect, test } from 'vitest';

import { composeResumeMessage } from './message.js';

describe('composeResumeMessage', () => {
  test('includes get-next-task and context read commands with real ids', () => {
    const message = composeResumeMessage({
      chatroomId: 'room123',
      role: 'builder',
    });

    expect(message).toContain('Your previous turn has ended.');
    expect(message).toContain('A pending chatroom task may already be waiting.');
    expect(message).toContain('foreground blocking bash tool call');
    expect(message).toContain('Do not reply with text only');
    expect(message).toContain('get-next-task blocks');
    expect(message).toContain('chatroom get-next-task --chatroom-id="room123" --role="builder"');
    expect(message).toContain('chatroom context read --chatroom-id="room123" --role="builder"');
  });

  test('omits get-next-task for native integration harnesses', () => {
    const message = composeResumeMessage({
      chatroomId: 'room123',
      role: 'builder',
      supportsNativeIntegration: true,
    });

    expect(message).not.toContain('get-next-task');
    expect(message).toContain('chatroom context read --chatroom-id="room123" --role="builder"');
  });
});
