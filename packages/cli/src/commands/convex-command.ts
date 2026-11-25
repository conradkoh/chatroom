/**
 * Shared plumbing for the daemon-free Convex commands (plan, grounding).
 *
 * `plan publish`, `plan read`, `grounding publish` and `grounding read` all talk
 * to Convex directly through the `BackendService`/`SessionService` ports, so they
 * share the dependency wiring, the session failure printing and the Convex error
 * extraction. Keeping it here means the commands cannot drift in how they report
 * the same failure.
 */

import { Effect } from 'effect';

import { createConvexCommandDeps } from '../infrastructure/deps/create-convex-command-deps.js';
import type { ConvexCommandDeps } from '../infrastructure/deps/create-convex-command-deps.js';
import { commandServicesLayerFromDeps } from '../infrastructure/services/index.js';
import type {
  BackendService,
  CommandSessionFailure,
  SessionService,
} from '../infrastructure/services/index.js';
import { formatAuthError, formatChatroomIdError } from '../utils/error-formatting.js';

/** Structured data carried by a Convex failure, when there is any. */
export interface ConvexErrorData {
  code?: string | undefined;
  message?: string | undefined;
}

/** True for the session/chatroom-id failures every chatroom command can hit. */
export function isSessionFailure(err: { readonly _tag: string }): err is CommandSessionFailure {
  return err._tag === 'NotAuthenticated' || err._tag === 'InvalidChatroomId';
}

/** Print an authentication or chatroom-id failure. */
export function printSessionFailure(err: CommandSessionFailure): void {
  if (err._tag === 'NotAuthenticated') return formatAuthError(err.convexUrl, err.otherUrls);
  formatChatroomIdError(err.id);
}

/**
 * Run a daemon-free Convex command effect with resolved deps, converting typed
 * errors to exit 1 through the command's own handler.
 */
export async function runConvexCommand<E>(
  deps: ConvexCommandDeps | undefined,
  program: Effect.Effect<void, E, BackendService | SessionService>,
  handleError: (err: E) => Effect.Effect<void>
): Promise<void> {
  const resolved = deps ?? (await createConvexCommandDeps());
  await Effect.runPromise(
    program.pipe(
      Effect.catch((err) => handleError(err)),
      Effect.provide(commandServicesLayerFromDeps(resolved))
    )
  );
}
