import { describe, expect, it, vi } from 'vitest';

import { createTurnOutputPublisher } from './turn-output.js';

describe('createTurnOutputPublisher', () => {
  it('appends turn chunk via appendMessages mutation', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createTurnOutputPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'turn.chunk',
      harnessSessionId: 'hs-1',
      content: 'hello',
      timestamp: 1000,
      messageId: 'msg-1',
      partType: 'text',
    });

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'sess-1',
        harnessSessionId: 'hs-1',
        chunks: [
          {
            content: 'hello',
            timestamp: 1000,
            messageId: 'msg-1',
            partType: 'text',
          },
        ],
      })
    );
  });

  it('finalizes assistant turn on turn.completed', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createTurnOutputPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'turn.completed',
      harnessSessionId: 'hs-1',
      turnId: 'turn-1',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      turnId: 'turn-1',
    });
  });
});
