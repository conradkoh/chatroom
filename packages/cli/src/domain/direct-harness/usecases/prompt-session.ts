/**
 * Domain use case: execute a prompt against a running harness session.
 *
 * Orchestrates:
 *   1. Read fresh session state from backend → get harnessSessionId
 *   2. If the session has no associated harness ID, complete with error
 *   3. Read the override stored on the pending prompt row
 *   4. Validate the override (agent must be non-empty)
 *   5. Resolve the live DirectHarnessSession from the local registry
 *   6. If no live session is found, complete with error
 *   7. Forward the prompt via session.prompt(input)
 *   8. Complete as 'done' on success, or 'error' with message on failure
 */

import type { HarnessSessionId } from '../entities/harness-session.js';
import type { PromptPart, PromptInput } from '../entities/direct-harness-session.js';
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

/** Reports prompt execution result back to the backend. */
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
  const { sessionQuery, overrideQuery, completion, sessionResolver } = deps;
  const { harnessSessionRowId, promptId, parts } = input;

  // 1. Read fresh session state from backend
  const harnessSessionId = await sessionQuery.getHarnessSessionId(harnessSessionRowId);

  // 2. If the session hasn't been spawned yet, fail fast
  if (!harnessSessionId) {
    await completion.complete(promptId, 'error', `Session ${harnessSessionRowId} has no associated harness session ID — spawn may not have completed`);
    return;
  }

  // 3. Read the override from the pending prompt row
  const override = await overrideQuery.getOverride(promptId);

  // 4. Validate override exists and has an agent
  if (!override || !override.agent || override.agent.trim() === '') {
    const msg = !override
      ? `No override found for prompt ${promptId}`
      : `promptSession: override.agent is required but was empty for prompt ${promptId}`;
    await completion.complete(promptId, 'error', msg);
    return;
  }

  // 5. Resolve the live harness session from the local registry
  const session = sessionResolver.getSession(harnessSessionId);

  // 6. If the session isn't running (daemon restart, or not yet resumed)
  if (!session) {
    await completion.complete(promptId, 'error', `Session ${harnessSessionId} is not running — may need to be resumed`);
    return;
  }

  // 7. Build the prompt input and forward to the harness
  const promptInput: PromptInput = {
    agent: override.agent,
    parts,
    ...(override.model !== undefined ? { model: override.model } : {}),
    ...(override.system !== undefined ? { system: override.system } : {}),
    ...(override.tools !== undefined ? { tools: override.tools } : {}),
  };

  try {
    await session.prompt(promptInput);

    // 8a. Mark done
    await completion.complete(promptId, 'done');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 8b. Mark error — best-effort, don't mask the original error
    await completion.complete(promptId, 'error', errorMessage).catch(() => {});
    throw err;
  }
}
