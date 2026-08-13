import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentLifecycleProjector } from './project-agent-status.js';

describe('createAgentLifecycleProjector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeDeps() {
    const mutation = vi.fn().mockResolvedValue(undefined);
    return {
      deps: {
        backend: { mutation, query: vi.fn() },
        sessionId: 'sess-1',
        machineId: 'machine-1',
        t1FlushWindowMs: 1000,
      },
      mutation,
    };
  }

  it('projects T3 lifecycle status events immediately', async () => {
    const { deps, mutation } = makeDeps();
    const projector = createAgentLifecycleProjector(deps);

    await projector.publish({
      type: 'restart.phase',
      idempotencyKey: 'room-1:builder:restart_phase_corr-1',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      correlationId: 'corr-1',
      phase: 'spawn',
      timestamp: 100,
    });

    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('batches T1 events (session_id_updated) and flushes after the flush window', async () => {
    vi.useFakeTimers();
    const { deps, mutation } = makeDeps();
    const projector = createAgentLifecycleProjector(deps);

    await projector.publish({
      type: 'harness.session_id_updated',
      idempotencyKey: 'room-1:builder:session_id_updated',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      correlationId: 'corr-1',
      resumableId: 'res-1',
      source: 'provider_rotated',
      timestamp: 100,
    });
    await projector.publish({
      type: 'harness.session_id_updated',
      idempotencyKey: 'room-1:builder:session_id_updated',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      correlationId: 'corr-1',
      resumableId: 'res-2',
      source: 'provider_rotated',
      timestamp: 200,
    });

    // Not yet flushed — no mutation call until the window elapses.
    expect(mutation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('flushes buffered T1 events on explicit flush()', async () => {
    const { deps, mutation } = makeDeps();
    const projector = createAgentLifecycleProjector(deps);

    await projector.publish({
      type: 'harness.session_id_updated',
      idempotencyKey: 'room-1:builder:session_id_updated',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      correlationId: 'corr-1',
      resumableId: 'res-1',
      source: 'provider_allocated',
      timestamp: 100,
    });

    await projector.flush();
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
