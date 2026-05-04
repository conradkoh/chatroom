import { describe, it, expect } from 'vitest';

import { SentenceFlushStrategy } from './sentence-strategy.js';
import type { FlushContext } from '../../../../../domain/direct-harness/ports/index.js';

const dummyCtx: FlushContext = {
  bufferByteSize: 0,
  bufferItemCount: 0,
  lastFlushAt: 0,
  now: 1000,
};

function buf(content: string) {
  return [{ content }];
}

describe('SentenceFlushStrategy', () => {
  const s = new SentenceFlushStrategy();

  it('never flushes an empty buffer', () => {
    expect(s.shouldFlush([], dummyCtx)).toBe(false);
  });

  it('does not flush mid-sentence text', () => {
    expect(s.shouldFlush(buf('hello world'), dummyCtx)).toBe(false);
  });

  it('flushes on period at end of text', () => {
    expect(s.shouldFlush(buf('hello world.'), dummyCtx)).toBe(true);
  });

  it('flushes on exclamation mark', () => {
    expect(s.shouldFlush(buf('Great!'), dummyCtx)).toBe(true);
  });

  it('flushes on question mark', () => {
    expect(s.shouldFlush(buf('Are you sure?'), dummyCtx)).toBe(true);
  });

  it('flushes with trailing quote after period', () => {
    expect(s.shouldFlush(buf('He said "ok."'), dummyCtx)).toBe(true);
  });

  it('flushes with trailing whitespace after terminator', () => {
    expect(s.shouldFlush(buf('Done. '), dummyCtx)).toBe(true);
  });

  it('does not flush on comma', () => {
    expect(s.shouldFlush(buf('incomplete,'), dummyCtx)).toBe(false);
  });

  it('uses the last item in the buffer (not any item)', () => {
    const buffer = [{ content: 'Done.' }, { content: 'still going' }];
    // Last item does NOT end in a terminator
    expect(s.shouldFlush(buffer, dummyCtx)).toBe(false);
  });

  it('handles items without content field (treats as empty string)', () => {
    expect(s.shouldFlush([{ seq: 1, content: 'no terminator' }], dummyCtx)).toBe(false);
  });

  it('has the correct name', () => {
    expect(s.name).toBe('sentence');
  });
});
