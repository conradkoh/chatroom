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
  Effect.catchAll(
    Effect.gen(function* () {
      const rowId = handle.harnessSessionId;

      if (handle.currentTurn) {
        const { turnId } = handle.currentTurn;
        handle.currentTurn = null;
        yield* Effect.tryPromise({ try: () => journal.flush(), catch: (e) => e }).pipe(
          Effect.flatMap(() =>
            Effect.tryPromise({
              try: () => sessionRepository.finalizeAssistantTurn(turnId),
              catch: (e) => e,
            })
          ),
          Effect.catchAll((err) =>
            Effect.sync(() => {
              console.warn(
                `[direct-harness] Failed to finalize turn ${turnId} for session ${rowId}:`,
                err instanceof Error ? err.message : String(err)
              );
            })
          )
        );
      }

      const next = yield* Effect.tryPromise({
        try: () => sessionRepository.dequeueNext(rowId),
        catch: (e) => e,
      });
      if (!next) return;

      yield* Effect.tryPromise({
        try: () => sessionRepository.beginAssistantTurn(rowId),
        catch: (e) => e,
      }).pipe(
        Effect.flatMap(({ turnId }) => {
          handle.currentTurn = { turnId, messageId: null };
          return Effect.tryPromise({
            try: () =>
              handle.session.prompt({
                parts: [{ type: 'text', text: next.content }],
                agent: config.agent,
                ...(config.model ? { model: config.model } : {}),
              }),
            catch: (e) => e,
          });
        }),
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () => sessionRepository.markTurnProcessed(rowId, next.seq),
            catch: (e) => e,
          })
        ),
        Effect.catchAll((err) =>
          Effect.gen(function* () {
            console.warn(
              `[direct-harness] Failed to prompt queued message for session ${rowId}:`,
              err instanceof Error ? err.message : String(err)
            );
            yield* Effect.promise(() => sessionRepository.setGenerating(rowId, false));
            handle.currentTurn = null;
          })
        )
      );
    }),
    (err) =>
      Effect.sync(() => {
        console.warn(
          `[direct-harness] Unexpected error in handleSessionIdleEffect:`,
          err instanceof Error ? err.message : String(err)
        );
      })
  );

/** Async wrapper — delegates to the Effect twin. */
export async function handleSessionIdle(
  handle: SessionHandle,
  journal: SessionJournal,
  config: IdleHandlerConfig,
  sessionRepository: SessionRepository
): Promise<void> {
  await Effect.runPromise(handleSessionIdleEffect(handle, journal, config, sessionRepository));
}
