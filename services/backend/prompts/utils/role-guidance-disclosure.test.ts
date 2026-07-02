import { describe, expect, test } from 'vitest';

import { getRoleGuidanceDisclosureBlock } from './role-guidance-disclosure';
import { roleGuidanceCommand } from '../cli/role-guidance/command';

describe('role-guidance command', () => {
  test('builds get-role-guidance with placeholders by default', () => {
    expect(roleGuidanceCommand()).toBe(
      'chatroom get-role-guidance --chatroom-id="<chatroom-id>" --role="<role>"'
    );
  });

  test('includes cli env prefix and real ids when provided', () => {
    expect(
      roleGuidanceCommand({
        cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
        chatroomId: 'room-123',
        role: 'planner',
      })
    ).toBe(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-role-guidance --chatroom-id="room-123" --role="planner"'
    );
  });
});

describe('role-guidance disclosure block', () => {
  test('includes checkbox and static-content HTML comment', () => {
    const block = getRoleGuidanceDisclosureBlock();
    expect(block).toContain(
      "I confirm that I've read and followed the role guidance before starting any work"
    );
    expect(block).toContain('Role guidance is static for your role');
    expect(block).toContain('You do not need to re-read it on every task');
    expect(block).toContain('chatroom get-role-guidance');
  });
});
