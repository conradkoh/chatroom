import { describe, expect, it, vi } from 'vitest';

import { createDaemonHeartbeatPublisher } from './daemon-heartbeat.js';

describe('createDaemonHeartbeatPublisher', () => {
  it('calls daemonHeartbeat mutation on heartbeat event', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createDaemonHeartbeatPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({ type: 'heartbeat', machineId: 'machine-1' });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });
  });

  it('no-ops on unrelated event types', async () => {
    const mutation = vi.fn();
    const publisher = createDaemonHeartbeatPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'turn.chunk',
      harnessSessionId: 'hs-1',
      content: 'hi',
      timestamp: 1,
    });

    expect(mutation).not.toHaveBeenCalled();
  });
});
