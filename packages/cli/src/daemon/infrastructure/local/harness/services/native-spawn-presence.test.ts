import { describe, expect, it, vi } from 'vitest';

import {
  emitNativeWaitingAfterSpawn,
  wireTokenActivityReporting,
} from './native-spawn-presence.js';
import { createHarnessActivityEmitter } from '../../../../services/agent-process-service/index.js';

function mockSpawnResult() {
  const callbacks: (() => void)[] = [];
  return {
    onOutput: vi.fn((cb: () => void) => {
      callbacks.push(cb);
    }),
    _fireOutput: () => {
      for (const cb of callbacks) cb();
    },
    _callbacks: callbacks,
  };
}

describe('emitNativeWaitingAfterSpawn', () => {
  it('enqueues native:waiting activity for team agent with native harness', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const backend = { mutation };
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      backend: backend as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      lifecycleOutbox: { enqueue },
    };

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode-sdk');

    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'activity', action: 'native:waiting', role: 'builder' })
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it('enqueues native:waiting activity for enhancer on native harness', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const backend = { mutation };
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      backend: backend as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'enhancer',
      lifecycleOutbox: { enqueue },
    };

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode-sdk');

    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'activity', action: 'native:waiting', role: 'enhancer' })
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it('does not call participants.join for non-native harness', async () => {
    const mutation = vi.fn();
    const backend = { mutation };
    const ctx = { backend: backend as any, sessionId: 's', chatroomId: 'c', role: 'builder' };

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode');

    expect(result).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('calls onError when mutation throws', async () => {
    const mutation = vi.fn().mockRejectedValue(new Error('session not found'));
    const backend = { mutation };
    const ctx = { backend: backend as any, sessionId: 's', chatroomId: 'c', role: 'builder' };
    const onError = vi.fn();

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode-sdk', { onError });

    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('wireTokenActivityReporting', () => {
  it('notifies turn progress for team agent roles', async () => {
    const onTurnProgress = vi.fn();
    const spawnResult = mockSpawnResult();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult,
      now: () => 1000,
      onTurnProgress,
    });
    spawnResult._fireOutput();

    expect(onTurnProgress).toHaveBeenCalledTimes(1);
    expect(onTurnProgress).toHaveBeenCalledWith({ chatroomId: 'c', role: 'builder' });
  });

  it('notifies turn progress for the enhancer team role', async () => {
    const onTurnProgress = vi.fn();
    const spawnResult = mockSpawnResult();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'enhancer',
      spawnResult,
      now: () => 1000,
      onTurnProgress,
    });
    spawnResult._fireOutput();

    expect(onTurnProgress).toHaveBeenCalledTimes(1);
    expect(onTurnProgress).toHaveBeenCalledWith({ chatroomId: 'c', role: 'enhancer' });
  });

  it('notifies turn progress on first output, throttled afterwards', async () => {
    const onTurnProgress = vi.fn();
    const spawnResult = mockSpawnResult();
    let clock = 1000;
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult,
      now: () => clock,
      throttleMs: 30_000,
      onTurnProgress,
    });
    spawnResult._fireOutput(); // first — fires
    clock = 15000;
    spawnResult._fireOutput(); // within 30s — should not fire
    clock = 45000;
    spawnResult._fireOutput(); // after 30s from last — should fire again

    expect(onTurnProgress).toHaveBeenCalledTimes(2);
    expect(onTurnProgress).toHaveBeenCalledWith({ chatroomId: 'c', role: 'builder' });
  });

  it('handles gracefully when onOutput is not available', () => {
    expect(() => {
      wireTokenActivityReporting({
        chatroomId: 'c',
        role: 'builder',
        spawnResult: {} as any, // no onOutput
        onTurnProgress: vi.fn(),
      });
    }).not.toThrow();
  });

  it('notifies exactly once for first progress in a turn', () => {
    const onTurnProgress = vi.fn();
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
      onTurnProgress,
    });

    emitter.emit({ kind: 'progress', source: 'test', at: 1000 });

    expect(onTurnProgress).toHaveBeenCalledTimes(1);
  });

  it('does not notify for transport, waiting, or failure signals', () => {
    const onTurnProgress = vi.fn();
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
      onTurnProgress,
    });

    emitter.emit({ kind: 'transport', source: 'test', at: 1000 });
    emitter.emit({ kind: 'waiting', source: 'test', at: 2000 });
    emitter.emit({ kind: 'failure', source: 'test', at: 3000 });

    expect(onTurnProgress).not.toHaveBeenCalled();
  });

  it('notifies only once for multiple progress signals in the same turn', () => {
    const onTurnProgress = vi.fn();
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
      onTurnProgress,
    });

    emitter.emit({ kind: 'progress', source: 'test', at: 1000 });
    emitter.emit({ kind: 'progress', source: 'test', at: 2000 });

    expect(onTurnProgress).toHaveBeenCalledTimes(1);
  });

  it('beginTurn permits one new progress update', () => {
    const onTurnProgress = vi.fn();
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
      onTurnProgress,
    });

    emitter.emit({ kind: 'progress', source: 'test', at: 1000 });
    emitter.beginTurn();
    emitter.emit({ kind: 'progress', source: 'test', at: 2000 });

    expect(onTurnProgress).toHaveBeenCalledTimes(2);
  });

  it('subscribes to the typed emitter only once', () => {
    const onTurnProgress = vi.fn();
    const emitter = createHarnessActivityEmitter();
    const onActivity = vi.spyOn(emitter, 'onActivity');
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
      onTurnProgress,
    });

    expect(onActivity).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a turn-progress handler', () => {
    const spawnResult = mockSpawnResult();
    wireTokenActivityReporting({
      chatroomId: 'c',
      role: 'builder',
      spawnResult,
      now: () => 1000,
    });
    expect(() => spawnResult._fireOutput()).not.toThrow();
  });
});
