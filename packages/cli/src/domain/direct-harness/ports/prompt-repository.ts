/**
 * Repository port for prompt lifecycle (reads, completion status).
 */

export interface PromptOverride {
  readonly agent: string;
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly system?: string;
  readonly tools?: Record<string, boolean>;
}

export interface PromptRepository {
  /** Read the override stored on a pending prompt row. */
  getOverride(promptId: string): Promise<PromptOverride | undefined>;

  /** Report prompt execution result back to the backend. */
  complete(promptId: string, status: 'done' | 'error', errorMessage?: string): Promise<void>;
}
