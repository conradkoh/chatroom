/**
 * Publish a validated grounding document (`chatroom grounding publish`).
 *
 * Calls Convex directly (no daemon, no CLI gateway), so the command works when
 * the daemon is down. The markdown is pre-validated with the same pure validator
 * the backend uses, so an invalid grounding exits 1 with line-numbered errors and
 * nothing is stored; the backend re-validates authoritatively.
 */

import { validateGrounding } from '@workspace/backend/src/domain/grounding/validate-grounding.js';
import type { GroundingError } from '@workspace/backend/src/domain/grounding/validate-grounding.js';
import { Effect } from 'effect';

import { api, type Id } from '../../api.js';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import * as runtime from '../convex-command.js';

export interface PublishGroundingOptions {
  role: string;
  content: string;
}

interface PublishErrorData extends runtime.ConvexErrorData {
  errors?: GroundingError[] | undefined;
}

export type PublishGroundingError =
  | runtime.CommandSessionFailure
  | { readonly _tag: 'InvalidGrounding'; readonly errors: readonly GroundingError[] }
  | {
      readonly _tag: 'GroundingPublishFailed';
      readonly cause: Error;
      readonly errorData?: PublishErrorData | undefined;
    };

interface PublishGroundingResult {
  messageId: string;
  groundingId: string;
}

interface PublishFailure {
  cause: Error;
  errorData?: PublishErrorData | undefined;
}

function toPublishFailure(cause: Error): PublishGroundingError {
  return {
    _tag: 'GroundingPublishFailed',
    cause,
    errorData: runtime.getConvexErrorData<PublishErrorData>(cause),
  };
}

function printGroundingErrors(errors: readonly GroundingError[]): void {
  for (const error of errors) {
    console.error(`   line ${error.line}: ${error.code} — ${error.message}`);
  }
}

function printInvalidGrounding(errors: readonly GroundingError[]): void {
  console.error('\n❌ Grounding not published');
  printGroundingErrors(errors);
  console.error('\n💡 Run `chatroom grounding view-template` to see the expected structure.');
}

function errorCode(err: PublishFailure): string | undefined {
  return err.errorData?.code;
}

function publishFailureMessage(err: PublishFailure): string {
  return err.errorData?.message ?? runtime.getErrorMessage(err.cause);
}

function printNoActiveTaskHint(code: string | undefined): void {
  if (code !== 'NO_ACTIVE_TASK') return;
  console.error('\n💡 `grounding publish` only works while you are working on a task.');
}

function printPublishFailure(err: PublishFailure): void {
  if (errorCode(err) === 'INVALID_GROUNDING') {
    return printInvalidGrounding(err.errorData?.errors ?? []);
  }
  console.error('\n❌ Grounding not published');
  console.error(`\n${publishFailureMessage(err)}`);
  printNoActiveTaskHint(errorCode(err));
}

function printPublishError(err: PublishGroundingError): void {
  if (runtime.isSessionFailure(err)) return runtime.printSessionFailure(err);
  if (err._tag === 'InvalidGrounding') return printInvalidGrounding(err.errors);
  printPublishFailure(err);
}

function handlePublishError(err: PublishGroundingError): Effect.Effect<void> {
  return Effect.sync(() => {
    printPublishError(err);
    process.exit(1);
  });
}

/** Validates before touching the backend so a bad grounding stores nothing. */
function preValidate(content: string): Effect.Effect<void, PublishGroundingError> {
  const validation = validateGrounding(content);
  if (validation.ok) return Effect.void;
  return Effect.fail({ _tag: 'InvalidGrounding' as const, errors: validation.errors });
}

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * Validation runs first so an invalid grounding never reaches the backend.
 */
const publishGroundingEffect = (
  chatroomId: string,
  options: PublishGroundingOptions
): Effect.Effect<void, PublishGroundingError, runtime.BackendService | runtime.SessionService> =>
  Effect.gen(function* () {
    yield* preValidate(options.content);

    const sessionId = yield* runtime.requireSessionForChatroomEffect({ chatroomId });
    const backend = yield* runtime.BackendService;

    const result = yield* backend
      .mutation<PublishGroundingResult>(api.groundings.publish, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: options.role,
        content: options.content,
      })
      .pipe(Effect.mapError(toPublishFailure));

    yield* Effect.sync(() => {
      console.log('✅ Grounding published');
      console.log(`   Grounding ID: ${result.groundingId}`);
      console.log(
        'Pass this ID in the "## Grounding" section of your handoff (see your handoff template).'
      );
    });
  });

/** CLI entry point: runs the effect and converts typed errors to exit 1. */
export async function publishGrounding(
  chatroomId: string,
  options: PublishGroundingOptions,
  deps?: ConvexCommandDeps
): Promise<void> {
  await runtime.runConvexCommand(
    deps,
    publishGroundingEffect(chatroomId, options),
    handlePublishError
  );
}
