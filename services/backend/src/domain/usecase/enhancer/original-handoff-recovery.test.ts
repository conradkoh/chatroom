import { describe, expect, test } from 'vitest';

import { buildOriginalHandoffRecoveryInstructions } from './original-handoff-recovery';

describe('buildOriginalHandoffRecoveryInstructions', () => {
  test('builds a scoped markdown recovery command', () => {
    const instructions = buildOriginalHandoffRecoveryInstructions({
      chatroomId: 'room_123',
      handoffMessageId: 'message_456',
    });

    expect(instructions).toContain('## Original Handoff');
    expect(instructions).toContain('--chatroom-id="room_123"');
    expect(instructions).toContain('--role="planner"');
    expect(instructions).toContain('--since-message-id="message_456"');
    expect(instructions).toContain('--limit=1');
    expect(instructions).toContain(
      '--output-dir=".chatroom/downloads/messages/linear/original-planner-handoff"'
    );
    expect(instructions).toContain(
      'cat ".chatroom/downloads/messages/linear/original-planner-handoff/"*.md'
    );
    expect(instructions).toContain('original planner → enhancer handoff');
  });

  test('returns no section when the original message is unavailable', () => {
    expect(
      buildOriginalHandoffRecoveryInstructions({
        chatroomId: 'room_123',
      })
    ).toBe('');
  });
});
