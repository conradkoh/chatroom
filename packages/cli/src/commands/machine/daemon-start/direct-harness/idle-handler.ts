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

import type {
  SessionHandle,
  SessionJournal,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';

export interface IdleHandlerConfig {
  agent: string;
  model?: { providerID: string; modelID: string };
}

export async function handleSessionIdle(
  handle: SessionHandle,
  journal: SessionJournal,
  config: IdleHandlerConfig,
  sessionRepository: SessionRepository
): Promise<void> {
  const rowId = handle.harnessSessionId;

  // Finalize the just-completed assistant turn (if any)
  if (handle.currentTurn) {
    const { turnId } = handle.currentTurn;
    handle.currentTurn = null;
    try {
      // Flush journal first to ensure all chunks are persisted before aggregating
      await journal.flush();
      await sessionRepository.finalizeAssistantTurn(turnId);
    } catch (err) {
      console.warn(
        `[direct-harness] Failed to finalize turn ${turnId} for session ${rowId}:`,
        err instanceof Error ? err.message : String(err)
      );
      // Continue — we don't want a finalization error to block dequeue
    }
  }

  const next = await sessionRepository.dequeueNext(rowId);
  if (!next) return; // queue empty — isGenerating cleared server-side

  try {
    // Begin a new assistant turn for the next prompt
    const { turnId } = await sessionRepository.beginAssistantTurn(rowId);
    handle.currentTurn = { turnId, messageId: null };

    await handle.session.prompt({
      parts: [{ type: 'text', text: next.content }],
      agent: config.agent,
      ...(config.model ? { model: config.model } : {}),
    });
    await sessionRepository.markTurnProcessed(rowId, next.seq);
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to prompt queued message for session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );
    // Clear the flag so the session doesn't get stuck in a generating state.
    await sessionRepository.setGenerating(rowId, false).catch(() => {});
    handle.currentTurn = null;
  }
}
