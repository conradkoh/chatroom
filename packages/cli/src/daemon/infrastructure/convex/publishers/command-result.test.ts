import { describe, expect, it, vi } from 'vitest';

import { createCommandResultPublisher } from './command-result.js';

describe('createCommandResultPublisher', () => {
  it('acks ping events', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createCommandResultPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({ type: 'command.result.ping', pingEventId: 'ping-1' });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      pingEventId: 'ping-1',
    });
  });

  it('reports folder picker results', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createCommandResultPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
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
