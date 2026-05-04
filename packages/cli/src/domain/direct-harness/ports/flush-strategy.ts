/**
 * @deprecated Flush strategies will become an internal detail of the JournalFactory
 *             implementation. Domain use cases no longer reference this type directly.
 *
 * Strategy interface for deciding when to flush a buffered message stream.
 */

/** Contextual information provided to a flush strategy on each write. */
export interface FlushContext {
  /** Total byte size of all items currently in the buffer. */
  readonly bufferByteSize: number;
  /** Number of items currently in the buffer. */
  readonly bufferItemCount: number;
  /** Epoch ms timestamp of the last successful flush (0 if never flushed). */
  readonly lastFlushAt: number;
  /** Current epoch ms, injected to allow deterministic testing. */
  readonly now: number;
}

/**
 * Determines whether the buffer should be flushed after each write.
 * Multiple strategies may be composed (e.g. Interval + Sentence).
 */
export interface FlushStrategy {
  /** Human-readable name, used in logs and composite strategy descriptions. */
  readonly name: string;
  /**
   * Returns true if the buffer should be flushed now.
   * The buffer contents are provided so size-aware strategies can inspect items.
   */
  shouldFlush<T>(buffer: readonly T[], ctx: FlushContext): boolean;
}
