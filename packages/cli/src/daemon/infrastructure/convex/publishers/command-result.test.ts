import { describe, expect, it, vi } from 'vitest';

import { createCommandResultPublisher } from './command-result.js';

describe('createCommandResultPublisher', () => {
  it('logs daemon.pong for ping events', async () => {
    const logEvent = vi.fn().mockResolvedValue(undefined);
    const publisher = createCommandResultPublisher({
      backend: { mutation: vi.fn(), query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      logEvent,
    });

    await publisher.publish({ type: 'command.result.ping', pingEventId: 'ping-1' });

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'daemon.pong',
        machineId: 'machine-1',
        pingEventId: 'ping-1',
      })
    );
  });

  it('reports folder picker results', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createCommandResultPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      logEvent: vi.fn().mockResolvedValue(undefined),
    });

    await publisher.publish({
      type: 'command.result.folder-picker',
      requestId: 'req-1',
      status: 'completed',
      selectedPath: '/tmp',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      requestId: 'req-1',
      status: 'completed',
      selectedPath: '/tmp',
      errorMessage: undefined,
    });
  });

  it('reports capabilities refresh results', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createCommandResultPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
      logEvent: vi.fn().mockResolvedValue(undefined),
    });

    await publisher.publish({
      type: 'command.result.capabilities-refresh',
      batchId: 'batch-1',
      status: 'failed',
      errorMessage: 'refresh failed',
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      batchId: 'batch-1',
      status: 'failed',
      errorMessage: 'refresh failed',
    });
  });
});
