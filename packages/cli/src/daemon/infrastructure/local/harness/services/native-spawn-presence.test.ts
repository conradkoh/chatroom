import { describe, expect, it, vi } from 'vitest';

import {
  emitNativeWaitingAfterSpawn,
  wireTokenActivityReporting,
} from './native-spawn-presence.js';
import { createHarnessActivityEmitter } from '../../../agent-process-manager/harness-activity-emitter.js';

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
  it('calls participants.join for team agent with native harness', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const backend = { mutation };
    const ctx = { backend: backend as any, sessionId: 's', chatroomId: 'c', role: 'builder' };

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode-sdk');

    expect(result).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
    const args = mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(args.role).toBe('builder');
    expect(args.action).toBe('native:waiting');
  });

  it('does not call participants.join for daemon worker (enhancer)', async () => {
    const mutation = vi.fn();
    const backend = { mutation };
    const ctx = { backend: backend as any, sessionId: 's', chatroomId: 'c', role: 'enhancer' };

    const result = await emitNativeWaitingAfterSpawn(ctx, 'opencode-sdk');

    expect(result).toBe(false);
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
  it('fires updateTokenActivity for team agent', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const backend = { mutation };
    const spawnResult = mockSpawnResult();
    const ctx = {
      backend: backend as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      spawnResult,
      now: () => 1000,
      throttleMs: 30_000,
    };

    wireTokenActivityReporting(ctx);
    spawnResult._fireOutput();

    expect(mutation).toHaveBeenCalledTimes(1);
    const args = mutation.mock.calls[0][1] as Record<string, unknown>;
    expect(args.role).toBe('builder');
  });

  it('does nothing for daemon worker (enhancer)', async () => {
    const mutation = vi.fn();
    const backend = { mutation };
    const spawnResult = mockSpawnResult();
    const ctx = {
      backend: backend as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'enhancer',
      spawnResult,
    };

    wireTokenActivityReporting(ctx);
    spawnResult._fireOutput();

    expect(mutation).not.toHaveBeenCalled();
  });

  it('does not fire updateTokenActivity again within throttle window', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const backend = { mutation };
    const spawnResult = mockSpawnResult();
    let clock = 1000;
    const ctx = {
      backend: backend as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      spawnResult,
      now: () => clock,
      throttleMs: 30_000,
    };

    wireTokenActivityReporting(ctx);
    spawnResult._fireOutput(); // first — fires
    clock = 15000;
    spawnResult._fireOutput(); // within 30s — should not fire
    clock = 45000;
    spawnResult._fireOutput(); // after 30s from last — should fire again

    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('handles gracefully when onOutput is not available', () => {
    const mutation = vi.fn();
    const backend = { mutation };
    const spawnResult = {} as any; // no onOutput

    expect(() => {
      wireTokenActivityReporting({
        backend: backend as any,
        sessionId: 's',
        chatroomId: 'c',
        role: 'builder',
        spawnResult,
      });
    }).not.toThrow();
  });

  it('fires exactly one mutation per emitted turn activity', () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      backend: { mutation } as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
    });

    emitter.emit('busy');

    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('fires a second mutation for a second emitted turn activity without throttle', () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const emitter = createHarnessActivityEmitter();
    wireTokenActivityReporting({
      backend: { mutation } as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
    });

    emitter.emit('busy');
    emitter.emit('busy');

    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('subscribes to the typed emitter only once', () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const emitter = createHarnessActivityEmitter();
    const onActivity = vi.spyOn(emitter, 'onActivity');
    wireTokenActivityReporting({
      backend: { mutation } as any,
      sessionId: 's',
      chatroomId: 'c',
      role: 'builder',
      spawnResult: mockSpawnResult(),
      activityEmitter: emitter,
    });

    expect(onActivity).toHaveBeenCalledTimes(1);
  });
});
