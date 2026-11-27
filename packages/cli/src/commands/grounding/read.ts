/**
 * Read a published grounding (`chatroom grounding read`).
 *
 * Calls Convex directly (no daemon, no CLI gateway). The grounding id is the
 * message id returned by `grounding publish`; the output is the stored markdown
 * with a short header and a neutral note that it records earlier observations.
 */

import { Effect } from 'effect';

import { api, type Id } from '../../api.js';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import * as runtime from '../convex-command.js';

export interface ReadGroundingOptions {
  /** Accepted so the prompt text keeps working. The backend identifies the reader from the session, so this is not read. */
  role?: string | undefined;
  groundingId: string;
}

export interface GroundingDetail {
  groundingId: string;
  senderRole: string;
  createdAt: number;
  content: string;
}

export type ReadGroundingError =
  | runtime.CommandSessionFailure
  | {
      readonly _tag: 'GroundingReadFailed';
      readonly cause: Error;
      readonly errorData?: runtime.ConvexErrorData | undefined;
    };

interface ReadFailure {
  cause: Error;
  errorData?: runtime.ConvexErrorData | undefined;
}

function toReadFailure(cause: Error): ReadGroundingError {
  return {
    _tag: 'GroundingReadFailed',
    cause,
    errorData: runtime.getConvexErrorData<runtime.ConvexErrorData>(cause),
  };
}

function printGroundingHeader(grounding: GroundingDetail): void {
  console.log(`Grounding ID: ${grounding.groundingId}`);
  console.log(`Author: ${grounding.senderRole}`);
  console.log(`Created: ${new Date(grounding.createdAt).toISOString()}`);
}

function printReadFailure(err: ReadFailure): void {
  if (err.errorData?.code === 'GROUNDING_NOT_FOUND') {
    console.error(`\n❌ ${runtime.getErrorMessage(err.cause)}`);
    console.error('   Check the grounding id reported by the author.');
    return;
  }
  console.error('\n❌ Could not read grounding');
  console.error(`\n${runtime.getErrorMessage(err.cause)}`);
}

function printReadError(err: ReadGroundingError): void {
  if (runtime.isSessionFailure(err)) return runtime.printSessionFailure(err);
  printReadFailure(err);
}

function handleReadError(err: ReadGroundingError): Effect.Effect<void> {
  return Effect.sync(() => {
    printReadError(err);
    process.exit(1);
  });
}

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * A malformed or foreign id surfaces as `GROUNDING_NOT_FOUND` from the backend.
 */
const readGroundingEffect = (
  chatroomId: string,
  options: ReadGroundingOptions
): Effect.Effect<void, ReadGroundingError, runtime.BackendService | runtime.SessionService> =>
  Effect.gen(function* () {
    const sessionId = yield* runtime.requireSessionForChatroomEffect({ chatroomId });
    const backend = yield* runtime.BackendService;

    const grounding = yield* backend
      .query<GroundingDetail>(api.groundings.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        groundingId: options.groundingId,
      })
      .pipe(Effect.mapError(toReadFailure));

    yield* Effect.sync(() => {
      printGroundingHeader(grounding);
      console.log('');
      console.log(grounding.content);
      console.log('');
      console.log('It records factual observations from an earlier pass.');
    });
  });

/** CLI entry point: runs the effect and converts typed errors to exit 1. */
export async function readGrounding(
  chatroomId: string,
  options: ReadGroundingOptions,
  deps?: ConvexCommandDeps
): Promise<void> {
  await runtime.runConvexCommand(deps, readGroundingEffect(chatroomId, options), handleReadError);
}
