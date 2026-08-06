import { describe, expect, it, vi } from 'vitest';

import { createSessionLifecyclePublisher } from './session-lifecycle.js';

describe('createSessionLifecyclePublisher', () => {
  it('associates opencode session on opened', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createSessionLifecyclePublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'session.lifecycle',
      harnessSessionId: 'hs-1',
      action: 'opened',
      opencodeSessionId: 'oc-1',
      sessionTitle: 'My Session',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      harnessSessionId: 'hs-1',
      opencodeSessionId: 'oc-1',
      sessionTitle: 'My Session',
    });
  });

  it('marks session active on resumed', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createSessionLifecyclePublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'session.lifecycle',
      harnessSessionId: 'hs-1',
      action: 'resumed',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      harnessSessionId: 'hs-1',
    });
  });
});
