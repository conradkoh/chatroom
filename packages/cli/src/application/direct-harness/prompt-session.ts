/**
 * Application use case: execute a prompt against a running harness session.
 *
 * Uses the override from the pending prompt row (not from lastUsedConfig) so the
 * agent the user selected at submit time is always honoured. Fails loud if
 * override.agent is missing or empty.
 *
 * Orchestrates:
 *   1. Fresh read of session row → harnessSessionId
 *   2. harness.prompt(harnessSessionId, { agent, model?, system?, tools?, parts })
 *   3. completePendingPrompt(done) on success, completePendingPrompt(error) on failure
 */

import type { FunctionReference, OptionalRestArgs } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { Id } from '../../api.js';
import { api } from '../../api.js';
import type {
  HarnessSessionId,
  PromptInput,
  PromptPart,
} from '../../domain/direct-harness/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal backend interface required by promptSession. */
export interface PromptSessionBackend {
  mutation<F extends FunctionReference<'mutation'>>(
    fn: F,
    ...args: OptionalRestArgs<F>
  ): Promise<F['_returnType']>;
  query<F extends FunctionReference<'query'>>(
    fn: F,
    ...args: OptionalRestArgs<F>
  ): Promise<F['_returnType']>;
}

/** Dependencies for promptSession. */
export interface PromptSessionDeps {
  readonly backend: PromptSessionBackend;
  readonly sessionId: SessionId;
  readonly machineId: string;
  /** Spawner to call prompt on (resolved from HarnessProcessRegistry). */
  readonly prompt: (harnessSessionId: HarnessSessionId, input: PromptInput) => Promise<void>;
}

/** The override carried on the pending prompt row. */
export interface PromptOverride {
  readonly agent: string;
  readonly model?: { readonly providerID: string; readonly modelID: string };
  readonly system?: string;
  readonly tools?: Record<string, boolean>;
}

/** Options for executing a prompt. */
export interface PromptSessionOptions {
  readonly harnessSessionRowId: string;
  readonly promptId: string;
  readonly parts: readonly PromptPart[];
  /** Override from the pending prompt row — agent MUST be non-empty. */
  readonly override: PromptOverride;
}

// ─── promptSession ────────────────────────────────────────────────────────────

/**
 * Execute a pending prompt against a harness session.
 *
 * Uses override.agent from the pending prompt row. Fails loud if it is missing
 * or empty — this is a defence-in-depth check; the schema also enforces it.
 */
export async function promptSession(
  deps: PromptSessionDeps,
  options: PromptSessionOptions
): Promise<void> {
  const { backend, sessionId, machineId } = deps;
  const { harnessSessionRowId, promptId, parts, override } = options;

  // Fail-loud: override.agent is required
  if (!override.agent || override.agent.trim() === '') {
    throw new Error(
      `promptSession: override.agent is required but was empty or missing for prompt ${promptId}`
    );
  }

  // 1. Fresh read — get harnessSessionId from session row
  const session = await backend.query(api.chatroom.directHarness.sessions.getSession, {
    sessionId,
    harnessSessionRowId: harnessSessionRowId as Id<'chatroom_harnessSessions'>,
  });

  if (!session || !session.harnessSessionId) {
    await backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: promptId as Id<'chatroom_pendingPrompts'>,
      status: 'error',
      errorMessage: `Session ${harnessSessionRowId} has no associated harness session ID — spawn may not have completed`,
    });
    return;
  }

  const { harnessSessionId } = session;

  // 2. Execute the prompt with the override from the pending prompt row
  const input: PromptInput = {
    agent: override.agent,
    parts,
    ...(override.model !== undefined ? { model: override.model } : {}),
    ...(override.system !== undefined ? { system: override.system } : {}),
    ...(override.tools !== undefined ? { tools: override.tools } : {}),
  };

  try {
    await deps.prompt(harnessSessionId as HarnessSessionId, input);

    // 3. Mark done
    await backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: promptId as Id<'chatroom_pendingPrompts'>,
      status: 'done',
    });
  } catch (err) {
    // 4. Mark error — user will see this in the UI
    await backend
      .mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
        sessionId,
        machineId,
        promptId: promptId as Id<'chatroom_pendingPrompts'>,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .catch(() => {
        // Best-effort — don't mask the original error
      });
    throw err;
  }
}
