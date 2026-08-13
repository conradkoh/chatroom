import { describe, expect, it, vi } from 'vitest';

import { createAgentLifecyclePublisher } from './agent-lifecycle.js';

describe('createAgentLifecyclePublisher', () => {
  function makeDeps() {
    const mutation = vi.fn().mockResolvedValue(undefined);
    return {
      deps: { backend: { mutation, query: vi.fn() }, sessionId: 'sess-1', machineId: 'machine-1' },
      mutation,
    };
  }

  it('projects agent.start_failed to machines.emitAgentStartFailed', async () => {
    const { deps, mutation } = makeDeps();
    const publisher = createAgentLifecyclePublisher(deps);

    await publisher.publish({
      type: 'agent.start_failed',
      idempotencyKey: 'room-1:builder:start_failed',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      error: 'spawn failed',
      timestamp: 100,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      role: 'builder',
      error: 'spawn failed',
    });
  });

  it('projects agent.native_end to participants.handleNativeAgentEnd', async () => {
    const { deps, mutation } = makeDeps();
    const publisher = createAgentLifecyclePublisher(deps);

    await publisher.publish({
      type: 'agent.native_end',
      idempotencyKey: 'room-1:builder:native_end_100',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      taskId: 'task-1',
      timestamp: 100,
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });
  });

  it('is a no-op for non-lifecycle events', async () => {
    const { deps, mutation } = makeDeps();
    const publisher = createAgentLifecyclePublisher(deps);

    await publisher.publish({ type: 'heartbeat', machineId: 'machine-1' });

    expect(mutation).not.toHaveBeenCalled();
  });
});
