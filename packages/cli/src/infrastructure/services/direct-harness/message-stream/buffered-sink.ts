/**
 * Default MessageStreamSink implementation with buffering, strategy-driven flushing,
 * drop-oldest backpressure, transport-retry, and observable warnings.
 */

import type { HarnessSessionRowId } from '../../../../domain/direct-harness/entities/harness-session.js';
import type {
  MessageStreamSink,
  MessageStreamSinkWarning,
  MessageStreamChunk,
  MessageStreamTransport,
  FlushStrategy,
  FlushContext,
} from '../../../../domain/direct-harness/ports/index.js';

// ─── Options ────────────────────────────────────────────────────────────────

/** Construction options for BufferedMessageStreamSink. */
export interface BufferedSinkOptions {
  /** Harness session whose output this sink is collecting. */
  readonly workerId: HarnessSessionRowId;
  /** Persistence layer; called with a snapshot of buffered chunks on flush. */
  readonly transport: MessageStreamTransport;
  /** Determines when the buffer should be flushed to the transport. */
  readonly strategy: FlushStrategy;
  /** Maximum items held in the buffer before drop-oldest backpressure kicks in. Default: 1000. */
  readonly maxBufferItems?: number;
  /** How often (ms) the strategy is evaluated by the background tick. Default: 100ms. */
  readonly tickIntervalMs?: number;
  /** Injected clock for deterministic testing. Default: Date.now. */
  readonly clock?: () => number;
  /** Injected setInterval for testing with fake timers. Default: global setInterval. */
  readonly setIntervalFn?: typeof setInterval;
  /** Injected clearInterval for testing with fake timers. Default: global clearInterval. */
  readonly clearIntervalFn?: typeof clearInterval;
}

// ─── Implementation ──────────────────────────────────────────────────────────

/**
 * Buffers harness output chunks and flushes them to the transport according to
 * the injected flush strategy.
 *
 * Invariants:
 * - Seq numbers are monotonically increasing across the sink lifetime.
 * - Concurrent flushes are serialized (no overlapping transport.persist calls).
 * - Transport failures re-prepend the snapshot in seq order and surface a warning.
 * - Backpressure drops the oldest chunk and emits a backpressure-drop warning.
 * - close() is idempotent; writes after close are silently dropped with a warning.
 */
export class BufferedMessageStreamSink implements MessageStreamSink {
  private readonly options: Required<
    Pick<BufferedSinkOptions, 'maxBufferItems' | 'tickIntervalMs' | 'clock' | 'setIntervalFn' | 'clearIntervalFn'>
  > &
    BufferedSinkOptions;

  private buffer: MessageStreamChunk[] = [];
  /** Running total of content.length for all items in buffer. */
  private bufferByteSize = 0;
  private nextSeq = 0;
  private lastFlushAt = 0;
  private closed = false;
  private readonly timer: ReturnType<typeof setInterval>;

  /**
   * Serialization chain — always resolves (doFlush catches errors internally).
   * New flushes are chained onto this so concurrent calls queue up correctly.
   */
  private flushChain: Promise<void> = Promise.resolve();

  private readonly warningListeners = new Set<(w: MessageStreamSinkWarning) => void>();

  constructor(options: BufferedSinkOptions) {
    this.options = {
      maxBufferItems: 1000,
      tickIntervalMs: 100,
      clock: Date.now,
      setIntervalFn: setInterval,
      clearIntervalFn: clearInterval,
      ...options,
    };

    this.timer = this.options.setIntervalFn(() => {
      this.evaluate();
    }, this.options.tickIntervalMs);

    // Don't keep the Node.js event loop alive for the tick timer
    (this.timer as NodeJS.Timeout).unref?.();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  write(chunk: Omit<MessageStreamChunk, 'seq' | 'timestamp'>): void {
    if (this.closed) {
      this.emitWarning({
        type: 'transport-error',
        message: 'Sink is closed — chunk dropped',
      });
      return;
    }

    // Backpressure: drop oldest before pushing so buffer never exceeds maxBufferItems
    if (this.buffer.length >= this.options.maxBufferItems) {
      const dropped = this.buffer.shift()!;
      this.bufferByteSize -= dropped.content.length;
      this.emitWarning({
        type: 'backpressure-drop',
        message: `Buffer full (${this.options.maxBufferItems} items) — oldest chunk dropped`,
        droppedCount: 1,
      });
    }

    const full: MessageStreamChunk = {
      seq: this.nextSeq++,
      content: chunk.content,
      timestamp: this.options.clock(),
    };
    this.buffer.push(full);
    this.bufferByteSize += full.content.length;
  }

  flush(): Promise<void> {
    // Chain onto the current serialization head so flushes never overlap
    const next = this.flushChain.then(() => this.doFlush());
    this.flushChain = next; // doFlush always resolves → chain always resolves
    return next;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Stop the background tick
    this.options.clearIntervalFn(this.timer);

    // Wait for any in-flight flushes, then do a final drain
    await this.flushChain;
    await this.doFlush();
  }

  onWarning(listener: (w: MessageStreamSinkWarning) => void): () => void {
    this.warningListeners.add(listener);
    return () => {
      this.warningListeners.delete(listener);
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Called by the background tick; triggers flush if strategy says so. */
  private evaluate(): void {
    const ctx: FlushContext = {
      bufferByteSize: this.bufferByteSize,
      bufferItemCount: this.buffer.length,
      lastFlushAt: this.lastFlushAt,
      now: this.options.clock(),
    };
    if (this.options.strategy.shouldFlush(this.buffer, ctx)) {
      void this.flush();
    }
  }

  /**
   * Attempt to persist the current buffer contents.
   * Always resolves — transport errors are surfaced via onWarning.
   */
  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Snapshot and clear atomically before awaiting transport
    const snapshot = this.buffer.slice();
    this.buffer = [];
    this.bufferByteSize = 0;

    try {
      await this.options.transport.persist(this.options.workerId, snapshot);
      this.lastFlushAt = this.options.clock();
    } catch (err) {
      // Re-prepend snapshot in original seq order; preserve any items written during the flight
      this.buffer = [...snapshot, ...this.buffer];
      this.bufferByteSize = this.buffer.reduce((sum, c) => sum + c.content.length, 0);
      const message = err instanceof Error ? err.message : String(err);
      this.emitWarning({
        type: 'transport-error',
        message: `Transport persist failed: ${message}`,
      });
      // Do NOT re-throw — error is surfaced via warning; serialization chain must not break
    }
  }

  private emitWarning(w: MessageStreamSinkWarning): void {
    for (const listener of this.warningListeners) {
      listener(w);
    }
  }
}
