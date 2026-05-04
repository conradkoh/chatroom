/**
 * Repository port for prompt completion reporting.
 *
 * The override is fetched by the daemon during claimNextPendingPrompt and
 * passed directly to the promptSession use case — no separate read needed.
 */

export interface PromptOverride {
  readonly agent: string;
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly system?: string;
  readonly tools?: Record<string, boolean>;
}

export interface PromptRepository {
  /** Report prompt execution result back to the backend. */
  complete(promptId: string, status: 'done' | 'error', errorMessage?: string): Promise<void>;
}
