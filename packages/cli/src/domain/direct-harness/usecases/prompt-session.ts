/**
 * Domain use case: execute a prompt against a running harness session.
 *
 * Orchestrates:
 *   1. Read fresh session state from backend → get harnessSessionId
 *   2. Validate the override (agent must be non-empty)
 *   3. Forward the prompt to the harness session via DirectHarnessSession.prompt()
 *   4. Complete the pending prompt (success or error)
 */

import type { HarnessSessionId } from '../entities/harness-session.js';
import type { PromptPart } from '../entities/direct-harness-session.js';
import type { HarnessSessionResolverPort } from '../ports/harness-orchestration-ports.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Reads session details from the backend by backend row ID. */
export interface SessionQueryPort {
  getHarnessSessionId(harnessSessionRowId: string): Promise<HarnessSessionId | undefined>;
}

/** Reads the override stored on a pending prompt row. */
export interface PromptOverrideQueryPort {
  getOverride(promptId: string): Promise<PromptOverride | undefined>;
}

/** Mutates the pending prompt row status after execution. */
export interface PromptCompletionPort {
  complete(promptId: string, status: 'done' | 'error', errorMessage?: string): Promise<void>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PromptOverride {
  readonly agent: string;
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly system?: string;
  readonly tools?: Record<string, boolean>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PromptSessionDeps {
  readonly sessionQuery: SessionQueryPort;
  readonly overrideQuery: PromptOverrideQueryPort;
  readonly completion: PromptCompletionPort;
  readonly sessionResolver: HarnessSessionResolverPort;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptSessionInput {
  readonly harnessSessionRowId: string;
  readonly promptId: string;
  readonly parts: readonly PromptPart[];
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function promptSession(
  deps: PromptSessionDeps,
  input: PromptSessionInput
): Promise<void> {
  throw new Error('Not implemented');
}
