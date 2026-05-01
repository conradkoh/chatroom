/**
 * Transport interface for persisting message stream chunks to the backend.
 */

import type { WorkerId } from '../harness-worker.js';

/** A single ordered chunk of content produced by a harness session. */
export interface MessageStreamChunk {
  /** Monotonically increasing sequence number within a worker's stream. */
  readonly seq: number;
  /** The text content of this chunk. */
  readonly content: string;
  /** Epoch ms when this chunk was produced. */
  readonly timestamp: number;
}

/** Responsible for durably persisting a batch of chunks for a given worker. */
export interface MessageStreamTransport {
  persist(workerId: WorkerId, chunks: readonly MessageStreamChunk[]): Promise<void>;
}
