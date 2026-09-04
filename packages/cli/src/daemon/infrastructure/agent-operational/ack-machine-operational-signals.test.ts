import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { ackMachineOperationalSignals } from './ack-machine-operational-signals.js';

const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';
const CHATROOM_ID = 'room-1';
const THROUGH_SIGNAL_KEY = '0000000000000042:room:builder';

function sessionDeps(
  mutation: ConvexClient['mutation']
): Parameters<typeof ackMachineOperationalSignals>[0] {
  return {
    sessionId: SESSION_ID,
    machineId: MACHINE_ID,
    backend: {
      mutation,
      query: vi.fn(),
    },
  } as never;
}

describe('ackMachineOperationalSignals', () => {
  it('continues through bounded batches with the same cursor and room id', async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ deletedCount: 100, hasMore: true })
      .mockResolvedValueOnce({ deletedCount: 1, hasMore: false });

    await ackMachineOperationalSignals(
      sessionDeps(mutation),
      MACHINE_ID,
      CHATROOM_ID,
      THROUGH_SIGNAL_KEY
    );

    expect(mutation).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        machineId: MACHINE_ID,
        chatroomId: CHATROOM_ID,
        throughSignalKey: THROUGH_SIGNAL_KEY,
      })
    );
    expect(mutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        machineId: MACHINE_ID,
        chatroomId: CHATROOM_ID,
        throughSignalKey: THROUGH_SIGNAL_KEY,
      })
    );
  });

  it('accepts an idempotent empty acknowledgement', async () => {
    const mutation = vi.fn().mockResolvedValue({ deletedCount: 0, hasMore: false });

    await expect(
      ackMachineOperationalSignals(
        sessionDeps(mutation),
        MACHINE_ID,
        CHATROOM_ID,
        THROUGH_SIGNAL_KEY
      )
    ).resolves.toBeUndefined();
    expect(mutation).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatroomId: CHATROOM_ID })
    );
  });

  it('throws when the backend reports more work without progress', async () => {
    const mutation = vi.fn().mockResolvedValue({ deletedCount: 0, hasMore: true });

    await expect(
      ackMachineOperationalSignals(
        sessionDeps(mutation),
        MACHINE_ID,
        CHATROOM_ID,
        THROUGH_SIGNAL_KEY
      )
    ).rejects.toThrow('Operational signal ack reported more work without progress');
    expect(mutation).toHaveBeenCalledOnce();
  });
});
