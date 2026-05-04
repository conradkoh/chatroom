/**
 * Convex-backed OutputRepository.
 *
 * Maps the domain OutputRepository port to Convex mutations:
 *   - appendChunks → messages.appendMessages mutation
 *   - updateTitle  → sessions.updateSessionConfig mutation
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
    harnessSessionRowId: string,
    chunks: readonly OutputChunk[]
  ): Promise<void> {
    const { backend, sessionId } = this.options;

    if (chunks.length === 0) return;

    await backend.mutation(api.chatroom.directHarness.messages.appendMessages, {
      sessionId,
      harnessSessionRowId,
      chunks: chunks.map((c) => ({
        content: c.content,
        timestamp: c.timestamp,
        seq: c.seq,
      })),
    });
  }

  async updateTitle(harnessSessionRowId: string, newTitle: string): Promise<void> {
    const { backend, sessionId } = this.options;

    await backend.mutation(api.chatroom.directHarness.sessions.updateSessionConfig, {
      sessionId,
      harnessSessionRowId,
      sessionTitle: newTitle,
    });
  }
}
