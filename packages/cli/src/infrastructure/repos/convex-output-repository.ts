/**
 * Convex-backed OutputRepository.
 *
 * Maps the domain OutputRepository port to Convex mutations:
 *   - appendChunks → messages.appendMessages mutation
 */

import { api } from '../../api.js';
import type { OutputRepository, OutputChunk } from '../../domain/direct-harness/ports/output-repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexOutputRepositoryOptions {
  readonly backend: { mutation: BackendCall };
  readonly sessionId: string;
}

export class ConvexOutputRepository implements OutputRepository {
  constructor(private readonly options: ConvexOutputRepositoryOptions) {}

  async appendChunks(
    harnessSessionId: string,
    chunks: readonly OutputChunk[]
  ): Promise<void> {
    const { backend, sessionId } = this.options;

    if (chunks.length === 0) return;

    await backend.mutation(api.daemon.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionId,
      chunks: chunks.map((c) => ({
        content: c.content,
        timestamp: c.timestamp,
        messageId: c.messageId,
        partType: c.partType,
      })),
    });
  }

}
