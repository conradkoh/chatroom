// fallow-ignore-file unused-class-member

import { api } from '../../api.js';
import type {
  OutputRepository,
  OutputChunk,
} from '../../domain/direct-harness/ports/output-repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexAgenticQueryOutputRepositoryOptions {
  readonly backend: { mutation: BackendCall };
  readonly sessionId: string;
}

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
