/**
 * Buffered journal factory — creates SessionJournal instances that buffer
 * output chunks in memory and periodically flush them to the backend.
 *
 * Streaming behaviour:
 *   - Chunks recorded via `record()` are buffered in memory.
 *   - A periodic interval (default 500ms) drains the buffer and writes
 *     to the OutputRepository, so the UI sees new chunks in near-real-time.
 *   - On `commit()` (called by closeSession), any remaining chunks are
 *     flushed and the interval is stopped.
 *
 * This is the infrastructure implementation — the domain interface
 * (SessionJournal) is unchanged. The flush strategy (time-based interval)
 * is internal to this class and can be swapped later.
 */

import type { SessionJournal, JournalFactory } from '../../domain/direct-harness/usecases/open-session.js';
import type { OutputRepository, OutputChunk } from '../../domain/direct-harness/ports/output-repository.js';

export interface BufferedJournalFactoryOptions {
  readonly outputRepository: OutputRepository;
  /** Flush interval in milliseconds. Default 500ms. */
  readonly flushIntervalMs?: number;
  /** Optional logger for debug/warnings. */
  readonly logger?: Pick<Console, 'warn'>;
}

export class BufferedJournalFactory implements JournalFactory {
  constructor(private readonly options: BufferedJournalFactoryOptions) {}

  create(harnessSessionRowId: string): SessionJournal {
    const { outputRepository, flushIntervalMs = 500, logger = console } = this.options;
    const buffer: OutputChunk[] = [];
    let flushInProgress = false;

    // Periodic drain: flush regardless of buffer state
    const intervalHandle = setInterval(() => {
      if (buffer.length === 0 || flushInProgress) return;
      flushInProgress = true;

      const batch = buffer.splice(0);
      outputRepository.appendChunks(harnessSessionRowId, batch).catch((err) => {
        // Re-queue failed chunks so they are not lost
        buffer.unshift(...batch);
        logger.warn('Journal flush failed, re-queued %d chunks: %s', batch.length, err instanceof Error ? err.message : String(err));
      }).finally(() => {
        flushInProgress = false;
      });
    }, flushIntervalMs);

    // Allow the interval to keep the process alive
    if (intervalHandle.unref) {
      intervalHandle.unref();
    }

    return {
      record(chunk: { content: string; timestamp: number }): void {
        buffer.push({
          content: chunk.content,
          timestamp: chunk.timestamp,
          seq: buffer.length + 1,
        });
      },

      async commit(): Promise<void> {
        // Stop the periodic drain first — no more flushes after this
        clearInterval(intervalHandle);

        // Flush whatever remains
        if (buffer.length === 0) return;

        const batch = buffer.splice(0);
        await outputRepository.appendChunks(harnessSessionRowId, batch);
      },
    };
  }
}
