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
  OutputRepository,
  OutputChunk,
  SessionJournal,
  JournalFactory,
} from '../../daemon/domain/usecase/open-harness-session.js';

export interface BufferedJournalFactoryOptions {
  readonly outputRepository: OutputRepository;
  /** Flush interval in milliseconds. Default 500ms. */
  readonly flushIntervalMs?: number | undefined;
  /** Optional logger for warnings (flush failures). */
  readonly logger?: Pick<Console, 'warn'> | undefined;
}

export class BufferedJournalFactory implements JournalFactory {
  constructor(private readonly options: BufferedJournalFactoryOptions) {}

  create(harnessSessionId: string): SessionJournal {
    const { outputRepository, flushIntervalMs = 500, logger = console } = this.options;
    const buffer: OutputChunk[] = [];
    let flushInProgress = false;

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

    // Periodic drain: flush regardless of buffer state
    const intervalHandle = setInterval(() => {
      if (buffer.length === 0 || flushInProgress) return;
      flushInProgress = true;

      const batch = buffer.splice(0);
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
        messageId?: string | undefined;
        partType?: 'text' | 'reasoning' | undefined;
      }): void {
        buffer.push({
          content: chunk.content,
          timestamp: chunk.timestamp,
          messageId: chunk.messageId,
          partType: chunk.partType,
        });
      },

      async flush(): Promise<void> {
        // Always wait for an in-flight periodic flush — the buffer may be empty
        // while chunks are still being appended (spliced out by the interval).
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

        await waitForInProgress();

        // Flush whatever remains
        if (buffer.length === 0) return;

        const batch = buffer.splice(0);
        await outputRepository.appendChunks(harnessSessionId, batch);
      },
    };
  }
}
