/**
 * Domain use case: execute a prompt against a running harness session.
 *
 * Orchestrates:
 *   1. Read fresh session state from backend → get harnessSessionId
 *   2. If the session has no associated harness ID, complete with error
 *   3. Read the override stored on the pending prompt row
 *   4. Validate the override (agent must be non-empty)
 *   5. Forward the prompt via session.prompt(input)
 *   6. Complete as 'done' on success, or 'error' with message on failure
 */

import type { PromptPart, PromptInput } from '../entities/direct-harness-session.js';
import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { PromptRepository } from '../ports/prompt-repository.js';

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
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function promptSession(
  deps: PromptSessionDeps,
  input: PromptSessionInput
): Promise<void> {
  const { sessionRepository, promptRepository, session } = deps;
  const { harnessSessionRowId, promptId, parts } = input;

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

  // 3. Read the override from the pending prompt row
  const override = await promptRepository.getOverride(promptId);

  // 4. Validate override exists and has an agent
  if (!override || !override.agent || override.agent.trim() === '') {
    const msg = !override
      ? `No override found for prompt ${promptId}`
      : `promptSession: override.agent is required but was empty for prompt ${promptId}`;
    await promptRepository.complete(promptId, 'error', msg);
    return;
  }

  // 5. Build the prompt input and forward to the harness
  const promptInput: PromptInput = {
    agent: override.agent,
    parts,
    ...(override.model !== undefined ? { model: override.model } : {}),
    ...(override.system !== undefined ? { system: override.system } : {}),
    ...(override.tools !== undefined ? { tools: override.tools } : {}),
  };

  try {
    await session.prompt(promptInput);

    // 6a. Mark done
    await promptRepository.complete(promptId, 'done');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 6b. Mark error — best-effort, don't mask the original error
    await promptRepository.complete(promptId, 'error', errorMessage).catch(() => {});
    throw err;
  }
}
