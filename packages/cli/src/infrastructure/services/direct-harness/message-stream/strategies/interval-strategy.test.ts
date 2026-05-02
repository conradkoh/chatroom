import { describe, it, expect, vi } from 'vitest';

import { IntervalFlushStrategy } from './interval-strategy.js';
import type { FlushContext } from '../../../../../domain/direct-harness/message-stream/index.js';

function makeCtx(overrides: Partial<FlushContext> = {}): FlushContext {
  return {
    bufferByteSize: 0,
    bufferItemCount: 0,
    lastFlushAt: 0,
    now: 1000,
    ...overrides,
  };
}

describe('IntervalFlushStrategy', () => {
  it('never flushes when the buffer is empty', () => {
    const s = new IntervalFlushStrategy(500);
    expect(s.shouldFlush([], makeCtx({ now: 99999 }))).toBe(false);
  });

  it('does not flush when elapsed time is less than the interval', () => {
    const s = new IntervalFlushStrategy(500);
    const ctx = makeCtx({ lastFlushAt: 1000, now: 1499 }); // 499ms elapsed
    expect(s.shouldFlush(['item'], ctx)).toBe(false);
  });

  it('flushes when elapsed time equals the interval', () => {
    const s = new IntervalFlushStrategy(500);
    const ctx = makeCtx({ lastFlushAt: 1000, now: 1500 }); // exactly 500ms
    expect(s.shouldFlush(['item'], ctx)).toBe(true);
  });

  it('flushes when elapsed time exceeds the interval', () => {
    const s = new IntervalFlushStrategy(500);
    const ctx = makeCtx({ lastFlushAt: 0, now: 10_000 }); // 10s elapsed
    expect(s.shouldFlush(['item'], ctx)).toBe(true);
  });

  it('has the correct name', () => {
    expect(new IntervalFlushStrategy(100).name).toBe('interval');
  });
});
