import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startUserMessageSubscribers } from './user-message-subscribers.js';

function mockWs() {
  const callbacks: ((value: unknown) => void)[] = [];
  const wsClient = {
    onUpdate: vi.fn((_q, _a, cb) => {
      callbacks.push(cb);
      return vi.fn();
    }),
  } as unknown as ConvexClient;
  return { wsClient, emit: (v: unknown) => callbacks.at(-1)?.(v) };
}

describe('startUserMessageSubscribers', () => {
  it('starts per-chatroom subscribers when CHATROOM_ID is unset', async () => {
    const ws = mockWs();
    const onEvent = vi.fn();
    const handle = startUserMessageSubscribers(
      {
        wsClient: ws.wsClient,
        sessionId: 's' as SessionId,
        machineId: 'm',
        loadUserIntentCursor: () => '0',
        saveUserIntentCursor: vi.fn(),
      },
      onEvent
    );

    ws.emit(['room-a', 'room-b']);
    await Promise.resolve();

    expect(ws.wsClient.onUpdate).toHaveBeenCalledTimes(3);

    await handle.stop();
  });

  it('uses a single subscriber when chatroomId is provided', async () => {
    const ws = mockWs();
    const handle = startUserMessageSubscribers(
      {
        wsClient: ws.wsClient,
        sessionId: 's' as SessionId,
        machineId: 'm',
        chatroomId: 'room-only',
        loadUserIntentCursor: () => '0',
        saveUserIntentCursor: vi.fn(),
      },
      vi.fn()
    );

    const messageSubscriptions = (ws.wsClient.onUpdate as ReturnType<typeof vi.fn>).mock.calls;
    expect(messageSubscriptions).toHaveLength(1);
    await handle.stop();
  });
});
