/**
 * Domain use case: execute a prompt against a running harness session.
 *
 * Orchestrates:
 *   1. Read fresh session state from backend → get harnessSessionId
 *   2. If the session has no associated harness ID, complete with error
 *   3. Validate the override (agent must be non-empty)
 *   4. Forward the prompt via session.prompt(input)
 *   5. Complete as 'done' on success, or 'error' with message on failure
 *
 * The override is provided by the caller (from claimNextPendingPrompt),
 * not fetched by this use case — avoids an extra Convex query when
 * the caller already has the data.
 */

import type { PromptPart, PromptInput } from '../entities/direct-harness-session.js';
import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { PromptRepository, PromptOverride } from '../ports/prompt-repository.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PromptSessionDeps {
  readonly sessionRepository: SessionRepository;
  readonly promptRepository: PromptRepository;
  /** The live harness session to prompt. Resolved by the caller. */
  readonly session: DirectHarnessSession;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptSessionInput {
  readonly harnessSessionRowId: string;
  readonly promptId: string;
  readonly parts: readonly PromptPart[];
  /**
   * Per-prompt config override (agent, model, etc.) as stored on the
   * pending prompt row. Provided by the caller from the claim result.
   */
  readonly override: PromptOverride;
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function promptSession(
  deps: PromptSessionDeps,
  input: PromptSessionInput
): Promise<void> {
  const { sessionRepository, promptRepository, session } = deps;
  const { harnessSessionRowId, promptId, parts, override } = input;

  // 1. Read fresh session state from backend
  const harnessSessionId = await sessionRepository.getHarnessSessionId(harnessSessionRowId);

  // 2. If the session hasn't been spawned yet, fail fast
  if (!harnessSessionId) {
    await promptRepository.complete(
      promptId,
      'error',
      `Session ${harnessSessionRowId} has no associated harness session ID — spawn may not have completed`
    );
    return;
  }

  // 3. Validate override has a non-empty agent
  if (!override.agent || override.agent.trim() === '') {
    await promptRepository.complete(
      promptId,
      'error',
      `promptSession: override.agent is required but was empty for prompt ${promptId}`
    );
    return;
  }

  // 4. Build the prompt input and forward to the harness
  const promptInput: PromptInput = {
    agent: override.agent,
    parts,
    ...(override.model !== undefined ? { model: override.model } : {}),
    ...(override.system !== undefined ? { system: override.system } : {}),
    ...(override.tools !== undefined ? { tools: override.tools } : {}),
  };

  try {
    await session.prompt(promptInput);

    // 5a. Mark done
    await promptRepository.complete(promptId, 'done');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 5b. Mark error — best-effort, don't mask the original error
    try {
      await promptRepository.complete(promptId, 'error', errorMessage);
    } catch {
      // Best-effort — swallow so the original error is not masked
    }
    throw err;
  }
}
