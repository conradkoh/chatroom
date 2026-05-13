/**
 * Buffered journal factory — creates SessionJournal instances that buffer
 * output chunks in memory and periodically flush them to the backend.
 *
 * Streaming behaviour:
 *   - Chunks recorded via `record()` are buffered in memory.
 *   - A periodic interval (default 1000ms) drains the buffer and writes
 *     to the OutputRepository, so the UI sees new chunks in near-real-time.
 *   - On `commit()` (called by closeSession), any remaining chunks are
 *     flushed and the interval is stopped.
 *
 * This is the infrastructure implementation — the domain interface
 * (SessionJournal) is unchanged. The flush strategy (time-based interval)
 * is internal to this class and can be swapped later.
 */

import type {
  SessionJournal,
  JournalFactory,
} from '../../domain/direct-harness/usecases/open-session.js';
import type {
  OutputRepository,
  OutputChunk,
} from '../../domain/direct-harness/ports/output-repository.js';

export interface BufferedJournalFactoryOptions {
  readonly outputRepository: OutputRepository;
  /** Flush interval in milliseconds. Default 500ms. */
  readonly flushIntervalMs?: number;
  /** Optional logger for debug/warnings + per-chunk record traces. */
  readonly logger?: Pick<Console, 'warn'> & Partial<Pick<Console, 'log'>>;
}

export class BufferedJournalFactory implements JournalFactory {
  constructor(private readonly options: BufferedJournalFactoryOptions) {}

  create(harnessSessionId: string): SessionJournal {
    const { outputRepository, flushIntervalMs = 500, logger = console } = this.options;
    const buffer: OutputChunk[] = [];
    let flushInProgress = false;

    // Periodic drain: flush regardless of buffer state
    const intervalHandle = setInterval(() => {
      if (buffer.length === 0 || flushInProgress) return;
      flushInProgress = true;

      const batch = buffer.splice(0);
      console.log(`[journal] Flushing ${batch.length} chunks for session ${harnessSessionId}`);
      outputRepository
        .appendChunks(harnessSessionId, batch)
        .catch((err) => {
          // Re-queue failed chunks so they are not lost
          buffer.unshift(...batch);
          logger.warn(
            `[journal] Flush FAILED for ${harnessSessionId}: ${err instanceof Error ? err.message : String(err)}`
          );
        })
        .finally(() => {
          flushInProgress = false;
        });
    }, flushIntervalMs);

    // Allow the interval to keep the process alive
    if (intervalHandle.unref) {
      intervalHandle.unref();
    }

    return {
      record(chunk: {
        content: string;
        timestamp: number;
        messageId?: string;
        partType?: 'text' | 'reasoning';
      }): void {
        buffer.push({
          content: chunk.content,
          timestamp: chunk.timestamp,
          messageId: chunk.messageId,
          partType: chunk.partType,
        });
        // Per-chunk trace so the daemon log shows individual chunks arriving
        // (the periodic flush log only fires every flushIntervalMs ms).
        logger.log?.(
          `[journal] chunk recorded session=${harnessSessionId} messageId=${chunk.messageId ?? '-'} partType=${chunk.partType ?? 'text'} bytes=${chunk.content.length}`
        );
      },

      async flush(): Promise<void> {
        if (buffer.length === 0) return;

        // Wait for any in-progress flush to settle
        const waitForInProgress = (): Promise<void> => {
          if (!flushInProgress) return Promise.resolve();
          return new Promise((resolve) => {
            const check = () => {
              if (!flushInProgress) resolve();
              else setTimeout(check, 10);
            };
            setTimeout(check, 10);
          });
        };
        await waitForInProgress();

        if (buffer.length === 0) return;
        flushInProgress = true;
        const batch = buffer.splice(0);
        try {
          await outputRepository.appendChunks(harnessSessionId, batch);
        } catch (err) {
          buffer.unshift(...batch);
          logger.warn(
            'Journal flush (explicit) failed, re-queued %d chunks: %s',
            batch.length,
            err instanceof Error ? err.message : String(err)
          );
          throw err;
        } finally {
          flushInProgress = false;
        }
      },

      async commit(): Promise<void> {
        // Stop the periodic drain first — no more flushes after this
        clearInterval(intervalHandle);

        // Flush whatever remains
        if (buffer.length === 0) return;

        const batch = buffer.splice(0);
        await outputRepository.appendChunks(harnessSessionId, batch);
      },
    };
  }
}
