import { describe, expect, test } from 'vitest';

import { generateShortPrompt, type PromptContext } from './generator';

const BASE_CONTEXT: PromptContext = {
  chatroomId: 'room-1',
  role: 'planner',
  teamName: 'Duo',
  teamRoles: ['planner', 'builder'],
};

describe('generateShortPrompt', () => {
  test('renders only the get-next-task command', () => {
    const prompt = generateShortPrompt({ ...BASE_CONTEXT, convexUrl: '' });

    expect(prompt).toBe('chatroom get-next-task --chatroom-id="room-1" --role="planner"');
  });

  test('never names the removed context read command', () => {
    const prompt = generateShortPrompt({
      ...BASE_CONTEXT,
      convexUrl: 'http://127.0.0.1:3210',
    });

    expect(prompt).not.toContain('context read');
    expect(prompt).toBe(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="room-1" --role="planner"'
    );
  });
});
