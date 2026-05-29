import { describe, expect, test } from 'vitest';

import { composeResumeMessage } from './message.js';

describe('composeResumeMessage', () => {
  test('includes get-next-task and context read commands with real ids', () => {
    const message = composeResumeMessage({
      chatroomId: 'room123',
      role: 'builder',
    });

    expect(message).toContain('Your previous turn has ended.');
    expect(message).toContain('chatroom get-next-task --chatroom-id="room123" --role="builder"');
    expect(message).toContain('chatroom context read --chatroom-id="room123" --role="builder"');
  });
});
