import { describe, expect, it, vi } from 'vitest';

import { createHarnessActivityEmitter } from './harness-activity-emitter.js';

describe('createHarnessActivityEmitter', () => {
  it('transport emits a typed signal with isFirstForTurn false', () => {
    const emitter = createHarnessActivityEmitter();
    const received: { kind: string; isFirstForTurn: boolean }[] = [];
    emitter.onActivity((signal) => {
      received.push({ kind: signal.kind, isFirstForTurn: signal.isFirstForTurn });
    });

    emitter.emit({ kind: 'transport', source: 'test.transport', at: 1000 });

    expect(received).toEqual([{ kind: 'transport', isFirstForTurn: false }]);
  });

  it('first progress after construction has isFirstForTurn true', () => {
    const emitter = createHarnessActivityEmitter();
    const received: boolean[] = [];
    emitter.onActivity((signal) => {
      if (signal.kind === 'progress') received.push(signal.isFirstForTurn);
    });

    emitter.emit({ kind: 'progress', source: 'test.progress', at: 1000 });

    expect(received).toEqual([true]);
  });

  it('subsequent progress before beginTurn has isFirstForTurn false', () => {
    const emitter = createHarnessActivityEmitter();
    const received: boolean[] = [];
    emitter.onActivity((signal) => {
      if (signal.kind === 'progress') received.push(signal.isFirstForTurn);
    });

    emitter.emit({ kind: 'progress', source: 'test.progress', at: 1000 });
    emitter.emit({ kind: 'progress', source: 'test.progress', at: 2000 });

    expect(received).toEqual([true, false]);
  });

  it('beginTurn makes the next progress signal first again', () => {
    const emitter = createHarnessActivityEmitter();
    const received: boolean[] = [];
    emitter.onActivity((signal) => {
      if (signal.kind === 'progress') received.push(signal.isFirstForTurn);
    });

    emitter.emit({ kind: 'progress', source: 'test.progress', at: 1000 });
    emitter.beginTurn();
    emitter.emit({ kind: 'progress', source: 'test.progress', at: 2000 });

    expect(received).toEqual([true, true]);
  });

  it('waiting and failure never become first progress', () => {
    const emitter = createHarnessActivityEmitter();
    const received: boolean[] = [];
    emitter.onActivity((signal) => {
      received.push(signal.isFirstForTurn);
    });

    emitter.emit({ kind: 'waiting', source: 'test.waiting', at: 1000 });
    emitter.emit({ kind: 'failure', source: 'test.failure', at: 2000 });
    emitter.emit({ kind: 'progress', source: 'test.progress', at: 3000 });

    expect(received).toEqual([false, false, true]);
  });

  it('unsubscribe stops delivery without affecting other subscribers', () => {
    const emitter = createHarnessActivityEmitter();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = emitter.onActivity(first);
    emitter.onActivity(second);

    emitter.emit({ kind: 'transport', source: 'test', at: 1000 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribe();
    emitter.emit({ kind: 'transport', source: 'test', at: 2000 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('emitted source and timestamp are preserved exactly', () => {
    const emitter = createHarnessActivityEmitter();
    let captured: { source: string; at: number } | undefined;
    emitter.onActivity((signal) => {
      captured = { source: signal.source, at: signal.at };
    });

    emitter.emit({ kind: 'progress', source: 'cursor-sdk.assistant', at: 42_000 });

    expect(captured).toEqual({ source: 'cursor-sdk.assistant', at: 42_000 });
  });
});
