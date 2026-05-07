/**
 * Handles the session.idle event emitted by the opencode SDK when the agent
 * finishes generating a response.
 *
 * On idle, the daemon dequeues the next waiting message (if any) and sends it
 * as the next prompt, keeping the pipeline flowing one message at a time.
 * When the queue is empty, dequeueNext clears isGenerating server-side.
 */

import type { DirectHarnessSession } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';

export interface IdleHandlerConfig {
  agent: string;
  model?: { providerID: string; modelID: string };
}

export async function handleSessionIdle(
  rowId: string,
  session: DirectHarnessSession,
  config: IdleHandlerConfig,
  sessionRepository: SessionRepository
): Promise<void> {
  const next = await sessionRepository.dequeueNext(rowId);
  if (!next) return; // queue empty — isGenerating cleared server-side

  try {
    await session.prompt({
      parts: [{ type: 'text', text: next.content }],
      agent: config.agent,
      ...(config.model ? { model: config.model } : {}),
    });
    await sessionRepository.updateLastProcessedSeq(rowId, next.seq);
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to prompt queued message for session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );
    // Clear the flag so the session doesn't get stuck in a generating state.
    await sessionRepository.setGenerating(rowId, false).catch(() => {});
  }
}
