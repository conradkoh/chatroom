/**
 * Buffered journal factory — creates SessionJournal instances that buffer
 * output chunks in memory and commit them via an OutputRepository.
 *
 * On commit(), all buffered chunks are flushed to the backend. If no chunks
 * have been recorded, commit() is a no-op.
 */

import type { SessionJournal, JournalFactory } from '../../domain/direct-harness/usecases/open-session.js';
import type { OutputRepository, OutputChunk } from '../../domain/direct-harness/ports/output-repository.js';

export interface BufferedJournalFactoryOptions {
  readonly outputRepository: OutputRepository;
  /** Maximum chunks to buffer before forcing an automatic flush. Default 100. */
  readonly maxBufferSize?: number;
}

export class BufferedJournalFactory implements JournalFactory {
  constructor(private readonly options: BufferedJournalFactoryOptions) {}

  create(harnessSessionRowId: string): SessionJournal {
    const { outputRepository, maxBufferSize = 100 } = this.options;
    const buffer: OutputChunk[] = [];

    return {
      record(chunk: { content: string; timestamp: number }): void {
        buffer.push({
          content: chunk.content,
          timestamp: chunk.timestamp,
          seq: buffer.length + 1,
        });

        if (buffer.length >= maxBufferSize) {
          // Automatic flush for overflow protection
          outputRepository.appendChunks(harnessSessionRowId, buffer).catch(() => {});
          buffer.length = 0;
        }
      },

      async commit(): Promise<void> {
        if (buffer.length === 0) return;

        const batch = buffer.splice(0);
        await outputRepository.appendChunks(harnessSessionRowId, batch);
      },
    };
  }
}
