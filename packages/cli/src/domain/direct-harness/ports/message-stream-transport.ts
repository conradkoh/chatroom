/**
 * Transport interface for persisting message stream chunks to the backend.
 */

import type { HarnessSessionRowId } from '../entities/harness-session.js';

/** A single ordered chunk of content produced by a harness session. */
export interface MessageStreamChunk {
  /** Monotonically increasing sequence number within a session's stream. */
  readonly seq: number;
  /** The text content of this chunk. */
  readonly content: string;
  /** Epoch ms when this chunk was produced. */
  readonly timestamp: number;
}

/** Responsible for durably persisting a batch of chunks for a given harness session. */
export interface MessageStreamTransport {
  persist(harnessSessionRowId: HarnessSessionRowId, chunks: readonly MessageStreamChunk[]): Promise<void>;
}
