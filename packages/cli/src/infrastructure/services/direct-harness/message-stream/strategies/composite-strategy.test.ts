import { describe, it, expect, vi } from 'vitest';

import { CompositeFlushStrategy } from './composite-strategy.js';
import type { FlushStrategy, FlushContext } from '../../../../../domain/direct-harness/message-stream/index.js';

const dummyCtx: FlushContext = {
  bufferByteSize: 0,
  bufferItemCount: 0,
  lastFlushAt: 0,
  now: 0,
};

function makeStrategy(name: string, result: boolean): FlushStrategy {
  return { name, shouldFlush: vi.fn().mockReturnValue(result) };
}

describe('CompositeFlushStrategy', () => {
  it('does not flush when no child strategies flush', () => {
    const s = new CompositeFlushStrategy([
      makeStrategy('a', false),
      makeStrategy('b', false),
    ]);
    expect(s.shouldFlush([], dummyCtx)).toBe(false);
  });

  it('flushes when at least one child strategy returns true', () => {
    const s = new CompositeFlushStrategy([
      makeStrategy('a', false),
      makeStrategy('b', true),
    ]);
    expect(s.shouldFlush([], dummyCtx)).toBe(true);
  });

  it('flushes when all child strategies return true', () => {
    const s = new CompositeFlushStrategy([
      makeStrategy('a', true),
      makeStrategy('b', true),
    ]);
    expect(s.shouldFlush([], dummyCtx)).toBe(true);
  });

  it('builds name from child strategy names', () => {
    const s = new CompositeFlushStrategy([
      makeStrategy('interval', false),
      makeStrategy('sentence', false),
    ]);
    expect(s.name).toBe('composite(interval+sentence)');
  });

  it('handles empty strategies list (never flushes)', () => {
    const s = new CompositeFlushStrategy([]);
    expect(s.shouldFlush(['item'], dummyCtx)).toBe(false);
    expect(s.name).toBe('composite()');
  });
});
