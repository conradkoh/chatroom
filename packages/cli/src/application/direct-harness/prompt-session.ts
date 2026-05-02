/**
 * Application use case: execute a prompt against a running harness session.
 *
 * Reads the session's current agent fresh-per-call (never cached from openSession)
 * so mid-chat agent switches via updateSessionAgent take effect immediately.
 *
 * Orchestrates:
 *   1. Fresh read of session row → agent + harnessSessionId
 *   2. harness.prompt(harnessSessionId, { agent, parts })
 *   3. completePendingPrompt(done) on success, completePendingPrompt(error) on failure
 */

import type { Id } from '../../api.js';
import { api } from '../../api.js';
import type { HarnessSessionId, PromptPart } from '../../domain/direct-harness/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal backend interface required by promptSession. */
export interface PromptSessionBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (endpoint: any, args: any) => Promise<any>;
}

/** Dependencies for promptSession. */
export interface PromptSessionDeps {
  readonly backend: PromptSessionBackend;
  readonly sessionId: string;
  readonly machineId: string;
  /** Spawner to call prompt on (resolved from HarnessProcessRegistry). */
  readonly prompt: (
    harnessSessionId: HarnessSessionId,
    input: { agent: string; parts: readonly PromptPart[] }
  ) => Promise<void>;
}

/** Options for executing a prompt. */
export interface PromptSessionOptions {
  readonly harnessSessionRowId: string;
  readonly promptId: string;
  readonly parts: readonly PromptPart[];
}

// ─── promptSession ────────────────────────────────────────────────────────────

/**
 * Execute a pending prompt against a harness session.
 *
 * Reads agent and harnessSessionId fresh from the backend each invocation
 * so mid-chat agent switches (via updateSessionAgent) take effect immediately.
 */
export async function promptSession(
  deps: PromptSessionDeps,
  options: PromptSessionOptions
): Promise<void> {
  const { backend, sessionId, machineId } = deps;
  const { harnessSessionRowId, promptId, parts } = options;

  // 1. Fresh read — get current agent and harnessSessionId from session row
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

  const { agent, harnessSessionId } = session;

  // 2. Execute the prompt with the current agent
  try {
    await deps.prompt(harnessSessionId as HarnessSessionId, { agent, parts });

    // 3. Mark done
    await backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: promptId as Id<'chatroom_pendingPrompts'>,
      status: 'done',
    });
  } catch (err) {
    // 4. Mark error — user will see this in the UI (c14)
    await backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId,
      machineId,
      promptId: promptId as Id<'chatroom_pendingPrompts'>,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    }).catch(() => {
      // Best-effort — don't mask the original error
    });
    throw err;
  }
}
