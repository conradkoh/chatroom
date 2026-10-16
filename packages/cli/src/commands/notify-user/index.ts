/**
 * Send the user an interim notice while you keep working on the task.
 *
 * Unlike `handoff`, this calls Convex directly (`api.messages.notifyUser`) with
 * no daemon and no CLI gateway: a notice is not a task transition, so it must
 * work even when the daemon is down. It never completes, creates, or reassigns
 * tasks — the success output says so explicitly.
 */

import { ConvexError } from 'convex/values';
import { Effect } from 'effect';

import { api, type Id } from '../../api.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionForChatroomEffect,
} from '../../infrastructure/services/index.js';
import type { CommandSessionFailure, SessionService } from '../../infrastructure/services/index.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NotifyUserOptions {
  role: string;
  message: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type NotifyUserError =
  | CommandSessionFailure
  | {
      readonly _tag: 'NotifyUserFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string | undefined; message?: string | undefined } | undefined;
    };

// ─── Effect Program ────────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; the caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const notifyUserEffect = (
  chatroomId: string,
  options: NotifyUserOptions
): Effect.Effect<void, NotifyUserError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const backend = yield* BackendService;

    const result = yield* backend
      .mutation<{ messageId: string }>(api.messages.notifyUser, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: options.role,
        content: options.message,
      })
      .pipe(
        Effect.mapError((cause): NotifyUserError => {
          let errorData: { code?: string | undefined; message?: string | undefined } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string | undefined; message?: string | undefined };
          }
          return { _tag: 'NotifyUserFailed', cause, errorData };
        })
      );

    yield* Effect.sync(() => {
      console.log('✅ Notice sent to user (task state unchanged)');
      console.log(`   Message ID: ${result.messageId}`);
      console.log('Continue working. Run `handoff` exactly once when this task is complete.');
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity code-duplication
function handleNotifyUserError(err: NotifyUserError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
      process.exit(1);
    } else if (err._tag === 'NotifyUserFailed') {
      console.error(`\n❌ ERROR: Notice not sent`);

      const message =
        err.errorData?.message ??
        (err.cause instanceof Error ? err.cause.message : String(err.cause));
      console.error(`\n${message}`);

      if (process.env.CHATROOM_DEBUG === 'true') {
        console.error('\n🔍 Debug Info:');
        console.error(JSON.stringify(err.errorData ?? err.cause, null, 2));
      }

      if (err.errorData?.code === 'NO_ACTIVE_TASK') {
        // The backend throws NO_ACTIVE_TASK when the sender has no
        // in_progress/acknowledged/pending task — which is also the
        // "already handed off" case.
        console.error(
          '\n💡 If you already ran handoff for this task, end your turn — do not hand off again.'
        );
      } else if (err.errorData?.code === 'INVALID_ROLE') {
        console.error('\n💡 Check your team configuration and use a valid role');
      }

      console.error('\n📚 Need help? Check the docs or run:');
      console.error(`   chatroom notify-user --help`);
      process.exit(1);
    }
  });
}

// ─── Entry Point ───────────────────────────────────────────────────────────

/**
 * Send the user an interim notice while continuing to work on the task.
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function notifyUser(
  chatroomId: string,
  options: NotifyUserOptions,
  deps?: ConvexCommandDeps
): Promise<void> {
  const d = deps ?? (await createConvexCommandDeps());

  await Effect.runPromise(
    notifyUserEffect(chatroomId, options).pipe(
      Effect.catch((err) => handleNotifyUserError(err)),
      Effect.provide(commandServicesLayerFromDeps(d))
    )
  );
}
