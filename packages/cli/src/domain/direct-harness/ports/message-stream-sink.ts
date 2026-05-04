/**
 * @deprecated Use SessionJournal (domain/direct-harness/usecases/open-session.js)
 *             and OutputRepository (domain/direct-harness/ports/output-repository.js)
 *             instead. Retained for backwards compatibility with the old
 *             application-layer infrastructure.
 *
 * Sink interface for buffering and flushing harness output to the backend.
 */

import type { MessageStreamChunk } from './message-stream-transport.js';

/** Describes a non-fatal issue encountered by the sink during operation. */
export interface MessageStreamSinkWarning {
  /** 'backpressure-drop': a chunk was dropped because the buffer was full.
   *  'transport-error': a flush failed to reach the backend. */
  readonly type: 'backpressure-drop' | 'transport-error';
  readonly message: string;
  /** Number of chunks dropped (only set for backpressure-drop warnings). */
  readonly droppedCount?: number;
}

/**
 * Accepts harness output chunks, buffers them, and periodically flushes to the
 * transport. Callers should call close() when the harness session ends to ensure
 * any remaining buffered content is flushed.
 */
export interface MessageStreamSink {
  /** Buffer a chunk for eventual flushing. Seq and timestamp are assigned by the sink. */
  write(chunk: Omit<MessageStreamChunk, 'seq' | 'timestamp'>): void;
  /** Immediately flush all buffered chunks to the transport. */
  flush(): Promise<void>;
  /** Flush remaining chunks and release resources. */
  close(): Promise<void>;
  /**
   * Subscribe to sink warnings (backpressure drops, transport errors).
   * Returns an unsubscribe function.
   */
  onWarning(listener: (w: MessageStreamSinkWarning) => void): () => void;
}
