/**
 * Convex-backed PromptRepository.
 *
 * Maps the domain PromptRepository port to Convex mutations:
 *   - complete → prompts.completePendingPrompt mutation
 */

import { api } from '../../api.js';
import type { PromptRepository } from '../../domain/direct-harness/ports/prompt-repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexPromptRepositoryOptions {
  readonly backend: { mutation: BackendCall };
  readonly sessionId: string;
}

export class ConvexPromptRepository implements PromptRepository {
  constructor(private readonly options: ConvexPromptRepositoryOptions) {}

  async complete(
    promptId: string,
    status: 'done' | 'error',
    errorMessage?: string
  ): Promise<void> {
    const { backend, sessionId } = this.options;

    await backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      promptId,
      status,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    });
  }
}
