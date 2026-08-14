import { describe, expect, it, vi } from 'vitest';

import { appendChatroomLog } from './append-chatroom-log.js';

describe('appendChatroomLog', () => {
  it('no-ops when sink is undefined', () => {
    expect(() =>
      appendChatroomLog(undefined, {
        chatroomId: 'room-1',
        type: 'agent.started',
        payload: {},
      })
    ).not.toThrow();
  });

  it('writes with defaulted timestamp', () => {
    const writeChatroomLog = vi.fn();
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);

    appendChatroomLog(
      { writeChatroomLog },
      {
        chatroomId: 'room-1',
        type: 'agent.started',
        role: 'builder',
        payload: { pid: 1 },
      }
    );

    expect(writeChatroomLog).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      type: 'agent.started',
      role: 'builder',
      payload: { pid: 1 },
      timestamp: now,
    });

    vi.restoreAllMocks();
  });
});
