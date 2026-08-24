import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startMachineCommandInboxSubscriber } from './machine-command-inbox.js';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';
const CLAIMED = {
  commandId: 'cmd-1',
  machineId: MACHINE_ID,
  type: 'daemon.ping' as const,
  deadline: Date.now() + 60_000,
  timestamp: Date.now(),
};
function createInboxMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];
  const claims: unknown[] = [];
  const mutation = vi.fn(async () => claims.shift() ?? null);
  const wsClient = {
    onUpdate: vi.fn((_q, _a, cb) => {
      callbacks.push(cb);
      return vi.fn();
    }),
    mutation,
    query: vi.fn(),
  } as unknown as ConvexClient;
  return {
    wsClient,
    mutation,
    emitWatch: (result: unknown) => callbacks.forEach((cb) => cb(result)),
    queueClaims: (...items: unknown[]) => claims.push(...items),
  };
}

describe('machine command inbox subscriber', () => {
  it('claims and forwards claimed command on watch nudge', async () => {
    const events: unknown[] = [];
    const mock = createInboxMockWsClient();
    mock.queueClaims(CLAIMED);
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      async (c) => {
        events.push({ type: 'command.received', commandId: c.commandId, claimedCommand: c });
      }
    );
    await new Promise((r) => setTimeout(r, 0));
    mock.emitWatch({ commandId: CLAIMED.commandId });
    await new Promise((r) => setTimeout(r, 0));
    await handle.stop();
    expect(mock.mutation).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'command.received',
      commandId: CLAIMED.commandId,
      claimedCommand: CLAIMED,
    });
  });
  it('serializes drain while onClaimed is in flight', async () => {
    const mock = createInboxMockWsClient();
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    mock.queueClaims({ ...CLAIMED, commandId: 'a' }, { ...CLAIMED, commandId: 'b' });
    const handle = startMachineCommandInboxSubscriber(
      { wsClient: mock.wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      async (c) => {
        seen.push(c.commandId);
        if (c.commandId === 'a') await gate;
      }
    );
    await new Promise((r) => setTimeout(r, 0));
    mock.emitWatch({ commandId: 'a' });
    mock.emitWatch({ commandId: 'b' });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['a']);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['a', 'b']);
    await handle.stop();
  });
});
