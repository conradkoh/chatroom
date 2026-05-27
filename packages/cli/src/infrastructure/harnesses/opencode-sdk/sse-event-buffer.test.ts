import { describe, it, expect, vi } from 'vitest';
import { SseEventBuffer } from './sse-event-buffer';

describe('SseEventBuffer', () => {
  // 1. push-then-iterate emits events in order
  it('push-then-iterate emits events in order', async () => {
    const buf = new SseEventBuffer<number>();
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.close();

    const result: number[] = [];
    for await (const event of buf) {
      result.push(event);
    }
    expect(result).toEqual([1, 2, 3]);
  });

  // 2. iterate-then-push wakes the awaiter
  it('iterate-then-push wakes the awaiter', async () => {
    const buf = new SseEventBuffer<string>();

    const collected: string[] = [];
    const iteratorDone = (async () => {
      for await (const event of buf) {
        collected.push(event);
        if (collected.length === 2) break;
      }
    })();

    // Give the iterator a tick to start awaiting
    await Promise.resolve();

    buf.push('hello');
    buf.push('world');

    await iteratorDone;

    expect(collected).toEqual(['hello', 'world']);
  });

  // 3. close() resolves with { done: true } when buffer is empty
  it('close() resolves with done when buffer is empty', async () => {
    const buf = new SseEventBuffer<number>();
    const iter = buf[Symbol.asyncIterator]();

    // Close immediately (no events pushed)
    // Start waiting first, then close
    const nextPromise = iter.next();
    buf.close();

    const result = await nextPromise;
    expect(result.done).toBe(true);
  });

  // 4. close() while events buffered: iterator drains them first, then done
  it('close() while events buffered: drains then done', async () => {
    const buf = new SseEventBuffer<number>();
    buf.push(10);
    buf.push(20);
    buf.close();

    const results: number[] = [];
    for await (const event of buf) {
      results.push(event);
    }

    expect(results).toEqual([10, 20]);
    expect(buf.closed).toBe(true);
  });

  // 5. overflow drops oldest, calls onOverflow with correct count, push never throws
  it('overflow drops oldest events and calls onOverflow', () => {
    const onOverflow = vi.fn();
    const buf = new SseEventBuffer<number>({ capacity: 3, onOverflow });

    buf.push(1);
    buf.push(2);
    buf.push(3);
    // Buffer is now full: [1, 2, 3]

    // Push a 4th — should drop 1 (oldest)
    expect(() => buf.push(4)).not.toThrow();
    expect(onOverflow).toHaveBeenCalledWith(1);
    expect(buf.size).toBe(3);

    // Push two more to fill again — buffer should become [3, 4, 5] then [4, 5, 6]
    buf.push(5);
    expect(onOverflow).toHaveBeenCalledWith(1); // dropped 3
    buf.push(6);
    expect(onOverflow).toHaveBeenCalledWith(1); // dropped 4

    expect(buf.size).toBe(3);
  });

  // 6. second [Symbol.asyncIterator]() call throws with a clear error
  it('second [Symbol.asyncIterator]() call throws', () => {
    const buf = new SseEventBuffer<number>();
    buf[Symbol.asyncIterator](); // first call — ok
    expect(() => buf[Symbol.asyncIterator]()).toThrow(
      /single consumer/i
    );
  });

  // 7. push after close is a no-op (silent, no throw)
  it('push after close is a no-op', async () => {
    const buf = new SseEventBuffer<number>();
    buf.push(1);
    buf.close();

    // Push after close — should not throw and should not enqueue
    expect(() => buf.push(2)).not.toThrow();

    const result: number[] = [];
    for await (const event of buf) {
      result.push(event);
    }

    // Only the pre-close event should appear
    expect(result).toEqual([1]);
    expect(buf.size).toBe(0);
  });
});
