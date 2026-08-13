import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';
import { startUserMessageSubscriber } from './user-message.js';

function mockWs() {
  const callbacks: ((value: unknown) => void)[] = [];
  const args: unknown[] = [];
  const wsClient = { onUpdate: vi.fn((_q, a, cb) => { args.push(a); callbacks.push(cb); return vi.fn(); }) } as unknown as ConvexClient;
  return { wsClient, args, emit: (v: unknown) => callbacks.at(-1)?.(v) };
}

describe('user-message subscriber', () => {
  it('advances cursor only after async ingestion and skips non-user rows', async () => {
    const ws = mockWs(); const save = vi.fn(); let resolve!: () => void; const pending = new Promise<void>((r) => { resolve = r; });
    const onEvent = vi.fn(() => pending);
    const handle = startUserMessageSubscriber({ wsClient: ws.wsClient, sessionId: 's' as SessionId, machineId: 'm', chatroomId: 'room', loadUserIntentCursor: () => '0', saveUserIntentCursor: save }, onEvent);
    ws.emit([{ _id: 'msg', _creationTime: 1000, senderRole: 'user', content: 'hi' }, { _id: 'handoff', _creationTime: 1001, senderRole: 'builder' }]);
    expect(save).not.toHaveBeenCalled(); resolve(); await vi.waitFor(() => expect(save).toHaveBeenCalledWith('1000')); await handle.stop();
    expect(onEvent).toHaveBeenCalledTimes(1); expect(ws.args.at(-1)).toMatchObject({ afterCreationTime: 1001 });
  });

  it('does not advance past a failed ingestion and stop waits for it', async () => {
    const ws = mockWs(); const save = vi.fn(); let resolve!: () => void; const pending = new Promise<void>((r) => { resolve = r; });
    const onEvent = vi.fn(() => pending); const handle = startUserMessageSubscriber({ wsClient: ws.wsClient, sessionId: 's' as SessionId, machineId: 'm', chatroomId: 'room', loadUserIntentCursor: () => '0', saveUserIntentCursor: save }, onEvent);
    ws.emit([{ _id: 'msg', _creationTime: 2000, senderRole: 'user' }]); const stopped = handle.stop(); await Promise.resolve(); expect(save).not.toHaveBeenCalled(); resolve(); await stopped; expect(save).toHaveBeenCalledWith('2000');
  });
});
