/**
 * SseEventBuffer<T>
 *
 * A per-session, single-consumer, bounded async-iterable buffer for raw SSE events.
 * No Effect dependency — this is a plain primitive.
 *
 * Design:
 * - Internally holds an array (queue) of buffered events and a single "waiter" resolve fn.
 * - push() enqueues and wakes the waiter if one is pending.
 * - On overflow, the OLDEST events are dropped (shift from front of queue).
 * - [Symbol.asyncIterator]() may only be called once; a second call throws.
 * - push() after close() is a no-op (silent, no throw).
 */

export interface SseEventBufferOptions {
  /** Max events buffered before drop-oldest kicks in. Default: 1024. */
  readonly capacity?: number;
  /** Called when overflow drops events. Receives count of dropped events in this push. */
  readonly onOverflow?: (dropped: number) => void;
}

export class SseEventBuffer<T> implements AsyncIterable<T> {
  private readonly _capacity: number;
  private readonly _onOverflow?: (dropped: number) => void;
  private _queue: T[] = [];
  private _closed = false;
  private _iteratorTaken = false;
  /** Resolve fn for the pending waiter, if any. */
  private _waiter: (() => void) | null = null;

  constructor(options?: SseEventBufferOptions) {
    this._capacity = options?.capacity ?? 1024;
    this._onOverflow = options?.onOverflow;
  }

  /**
   * Enqueue an event.
   * If the buffer is full, the oldest events are dropped to make room.
   * If the buffer is closed, this is a no-op.
   */
  push(event: T): void {
    if (this._closed) {
      // no-op after close
      return;
    }

    let dropped = 0;
    while (this._queue.length >= this._capacity) {
      this._queue.shift();
      dropped++;
    }
    if (dropped > 0 && this._onOverflow) {
      this._onOverflow(dropped);
    }

    this._queue.push(event);
    this._wake();
  }

  /**
   * Close the buffer.
   * The iterator will drain remaining buffered events, then signal done.
   */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._wake();
  }

  get closed(): boolean {
    return this._closed;
  }

  get size(): number {
    return this._queue.length;
  }

  /** Wake the waiter if one is pending. */
  private _wake(): void {
    if (this._waiter) {
      const resolve = this._waiter;
      this._waiter = null;
      resolve();
    }
  }

  /** Wait until there is at least one event or the buffer is closed. */
  private _waitForData(): Promise<void> {
    return new Promise<void>((resolve) => {
      this._waiter = resolve;
    });
  }

  /**
   * Single-consumer async iterator.
   * Calling this method a second time throws.
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this._iteratorTaken) {
      throw new Error(
        'SseEventBuffer: [Symbol.asyncIterator]() called more than once — only a single consumer is allowed.'
      );
    }
    this._iteratorTaken = true;

    const self = this;

    return {
      async next(): Promise<IteratorResult<T>> {
        // Loop until we have an event or the buffer is closed and drained.
        while (true) {
          if (self._queue.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return { done: false, value: self._queue.shift()! };
          }
          if (self._closed) {
            return { done: true, value: undefined as unknown as T };
          }
          // Await a push() or close() signal.
          await self._waitForData();
        }
      },
    };
  }
}
