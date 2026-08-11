import { describe, expect, test, vi } from 'vitest';

import { sendUserMessage } from './send.js';

function deps() {
  return {
    backend: {
      query: vi.fn().mockResolvedValue({ teamEntryPoint: 'planner' }),
      mutation: vi.fn().mockResolvedValue('message_1'),
    },
    session: { getSessionId: vi.fn().mockResolvedValue('session_1') },
  };
}

describe('sendUserMessage', () => {
  test('defaults the target role to the chatroom entry point', async () => {
    const d = deps();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendUserMessage('room_1', { content: 'hello' }, d);
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatroomId: 'room_1',
        senderRole: 'user',
        content: 'hello',
        targetRole: 'planner',
        type: 'message',
      })
    );
    expect(log.mock.calls.join('\n')).toContain('message_1');
    log.mockRestore();
  });

  test('uses an explicit target role', async () => {
    const d = deps();
    await sendUserMessage('room_1', { content: 'hello', targetRole: 'solo' }, d);
    expect(d.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetRole: 'solo' })
    );
  });
});
