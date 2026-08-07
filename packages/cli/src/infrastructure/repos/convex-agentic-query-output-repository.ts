import type { ConvexMutationRepositoryOptions } from './convex-repository-options.js';
import { api } from '../../api.js';
import type {
  OutputRepository,
  OutputChunk,
} from '../../daemon/domain/usecase/open-harness-session.js';

export type ConvexAgenticQueryOutputRepositoryOptions = ConvexMutationRepositoryOptions;

export class ConvexAgenticQueryOutputRepository implements OutputRepository {
  constructor(private readonly options: ConvexAgenticQueryOutputRepositoryOptions) {}

  async appendChunks(runId: string, chunks: readonly OutputChunk[]): Promise<void> {
    const { backend, sessionId } = this.options;

    if (chunks.length === 0) return;

    await backend.mutation(api.daemon.agenticQuery.messages.appendMessages, {
      sessionId,
      runId,
      chunks: chunks.map((c) => ({
        content: c.content,
        timestamp: c.timestamp,
        messageId: c.messageId,
        partType: c.partType,
      })),
    });
  }
}
