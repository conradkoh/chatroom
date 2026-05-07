/**
 * Repository port for persisting session output (message chunks, title changes).
 *
 * The SessionJournal buffers chunks in memory and calls this repository
 * on commit to flush them to the backend.
 */

export interface OutputChunk {
  readonly content: string;
  readonly timestamp: number;
}

export interface OutputRepository {
  /** Append a batch of ordered output chunks to a session. */
  appendChunks(
    harnessSessionRowId: string,
    chunks: readonly OutputChunk[]
  ): Promise<void>;
}
