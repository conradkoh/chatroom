/**
 * Convex-backed PromptRepository.
 *
 * Maps the domain PromptRepository port to Convex mutations/queries:
 *   - getOverride → prompts.getSessionPromptQueue query (reads the pending prompt override)
 *   - complete    → prompts.completePendingPrompt mutation
 */

import { api } from '../../api.js';
import type {
  PromptRepository,
  PromptOverride,
} from '../../domain/direct-harness/ports/prompt-repository.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexPromptRepositoryOptions {
  readonly backend: { mutation: BackendCall; query: BackendCall };
  readonly sessionId: string;
}

export class ConvexPromptRepository implements PromptRepository {
  constructor(private readonly options: ConvexPromptRepositoryOptions) {}

  async getOverride(promptId: string): Promise<PromptOverride | undefined> {
    const { backend } = this.options;

    const row = await backend.query(api.chatroom.directHarness.prompts.getSessionPromptQueue, {
      promptId,
    }) as {
      agent?: string;
      model?: { providerID: string; modelID: string };
      system?: string;
      tools?: Record<string, boolean>;
    } | null;

    if (!row) return undefined;

    return {
      agent: row.agent ?? '',
      ...(row.model ? { model: row.model } : {}),
      ...(row.system ? { system: row.system } : {}),
      ...(row.tools ? { tools: row.tools } : {}),
    };
  }

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
