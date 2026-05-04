import { describe, it, expect } from 'vitest';

import { TokenCountFlushStrategy } from './token-count-strategy.js';
import type { FlushContext } from '../../../../../domain/direct-harness/ports/index.js';

function makeCtx(overrides: Partial<FlushContext> = {}): FlushContext {
  return {
    bufferByteSize: 0,
    bufferItemCount: 0,
    lastFlushAt: 0,
    now: 0,
    ...overrides,
  };
}

describe('TokenCountFlushStrategy', () => {
  it('does not flush when below both thresholds', () => {
    const s = new TokenCountFlushStrategy(10, 1000);
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 5, bufferByteSize: 100 }))).toBe(false);
  });

  it('flushes when maxItems is reached', () => {
    const s = new TokenCountFlushStrategy(10);
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 10, bufferByteSize: 0 }))).toBe(true);
  });

  it('flushes when maxItems is exceeded', () => {
    const s = new TokenCountFlushStrategy(10);
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 15 }))).toBe(true);
  });

  it('flushes when maxBytes is reached', () => {
    const s = new TokenCountFlushStrategy(100, 512);
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 5, bufferByteSize: 512 }))).toBe(true);
  });

  it('flushes when maxBytes is exceeded', () => {
    const s = new TokenCountFlushStrategy(100, 512);
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 5, bufferByteSize: 600 }))).toBe(true);
  });

  it('uses POSITIVE_INFINITY as default maxBytes (no byte limit)', () => {
    const s = new TokenCountFlushStrategy(10);
    // Very large byte size should not trigger a flush if item count is below maxItems
    expect(s.shouldFlush([], makeCtx({ bufferItemCount: 5, bufferByteSize: 1_000_000 }))).toBe(false);
  });

  it('has the correct name', () => {
    expect(new TokenCountFlushStrategy(5).name).toBe('token-count');
  });
});
