import { describe, it, expect } from 'vitest';

import { LogBufferStore } from './log-buffer.js';

describe('LogBufferStore', () => {
  it('stores and retrieves log lines', () => {
    const store = new LogBufferStore();
    store.append({ processId: 'convex', stream: 'stdout', text: 'hello', timestamp: 1 });
    store.append({ processId: 'convex', stream: 'stderr', text: 'world', timestamp: 2 });
    const snapshot = store.snapshot();
    expect(snapshot.convex).toHaveLength(2);
    expect(snapshot.convex[0].text).toBe('hello');
    expect(snapshot.convex[1].text).toBe('world');
  });

  it('evicts oldest lines when exceeding MAX_LINES', () => {
    const store = new LogBufferStore();
    for (let i = 0; i < 2500; i++) {
      store.append({ processId: 'convex', stream: 'stdout', text: `line ${i}`, timestamp: i });
    }
    const snapshot = store.snapshot();
    expect(snapshot.convex).toHaveLength(2000);
    expect(snapshot.convex[0].text).toBe('line 500');
    expect(snapshot.convex[1999].text).toBe('line 2499');
  });

  it('returns empty arrays for uninitialized processes', () => {
    const store = new LogBufferStore();
    const snapshot = store.snapshot();
    expect(snapshot.convex).toEqual([]);
    expect(snapshot.webapp).toEqual([]);
    expect(snapshot.daemon).toEqual([]);
  });

  it('clears logs for a process', () => {
    const store = new LogBufferStore();
    store.append({ processId: 'convex', stream: 'stdout', text: 'hello', timestamp: 1 });
    store.clear('convex');
    expect(store.snapshot().convex).toEqual([]);
  });
});
