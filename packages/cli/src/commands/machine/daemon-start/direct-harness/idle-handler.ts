/**
 * Handles the session.idle event emitted by the opencode SDK when the agent
 * finishes generating a response.
 *
 * On idle, the daemon finalizes the just-completed turn (flushing the journal
 * first to ensure all chunks are persisted), then dequeues the next waiting
 * message (if any) and sends it as the next prompt, keeping the pipeline
 * flowing one message at a time. When the queue is empty, dequeueNext clears
 * isGenerating server-side.
 */

import { Effect } from 'effect';

import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  SessionHandle,
  SessionJournal,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';

export interface IdleHandlerConfig {
  agent: string;
  model?: { providerID: string; modelID: string };
}

/** Effect twin — canonical implementation. */
// fallow-ignore-next-line unused-export
export const handleSessionIdleEffect = (
  handle: SessionHandle,
  journal: SessionJournal,
  config: IdleHandlerConfig,
  sessionRepository: SessionRepository
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const rowId = handle.harnessSessionId;

    // Finalize the just-completed assistant turn (if any)
    if (handle.currentTurn) {
      const { turnId } = handle.currentTurn;
      handle.currentTurn = null;
      const finalized = yield* Effect.promise(() =>
        tryFinalize(journal, sessionRepository, turnId, rowId)
      );
      if (!finalized) {
        // Continue — we don't want a finalization error to block dequeue
      }
    }

    const next = yield* Effect.promise(() => sessionRepository.dequeueNext(rowId));
    if (!next) return; // queue empty — isGenerating cleared server-side

    const prompted = yield* Effect.promise(() =>
      tryPrompt(handle, sessionRepository, config, next, rowId)
    );
    if (!prompted) {
      yield* Effect.promise(() => sessionRepository.setGenerating(rowId, false).catch(() => {}));
      handle.currentTurn = null;
    }
  });

async function tryFinalize(
  journal: SessionJournal,
  sessionRepository: SessionRepository,
  turnId: string,
  rowId: string
): Promise<boolean> {
  try {
    await journal.flush();
    await sessionRepository.finalizeAssistantTurn(turnId);
    return true;
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to finalize turn ${turnId} for session ${rowId}:`,
      getErrorMessage(err)
    );
    return false;
  }
}

async function tryPrompt(
  handle: SessionHandle,
  sessionRepository: SessionRepository,
  config: IdleHandlerConfig,
  next: { content: string; seq: number },
  rowId: string
): Promise<boolean> {
  try {
    const { turnId } = await sessionRepository.beginAssistantTurn(rowId);
    handle.currentTurn = { turnId, messageId: null };
    await handle.session.prompt({
      parts: [{ type: 'text', text: next.content }],
      agent: config.agent,
      ...(config.model ? { model: config.model } : {}),
    });
    await sessionRepository.markTurnProcessed(rowId, next.seq);
    return true;
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to prompt queued message for session ${rowId}:`,
      getErrorMessage(err)
    );
    return false;
  }
}

/** Async wrapper — delegates to the Effect twin. */
export async function handleSessionIdle(
  handle: SessionHandle,
  journal: SessionJournal,
  config: IdleHandlerConfig,
  sessionRepository: SessionRepository
): Promise<void> {
  await Effect.runPromise(handleSessionIdleEffect(handle, journal, config, sessionRepository));
}
