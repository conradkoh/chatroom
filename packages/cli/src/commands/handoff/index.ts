/**
 * Complete a task and hand off to the next role
 *
 * This command uses the atomic handoff mutation which performs all of
 * these operations in a single transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 * 6. Promotes the next queued task to pending
 * Phase 4: Migrated to Effect-TS services with typed error handling.
 */

import { generateHandoffOutput } from '@workspace/backend/prompts/generator.js';
import { ConvexError } from 'convex/values';
import { Effect } from 'effect';

import type { HandoffDeps } from './deps.js';
import { syncGitAfterUserHandoff } from './sync-git-after-user-handoff.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  SessionService,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { HandoffDeps } from './deps.js';
export { syncGitAfterUserHandoff } from './sync-git-after-user-handoff.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type HandoffError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | {
      readonly _tag: 'HandoffFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string; message?: string };
    }
  | {
      readonly _tag: 'HandoffRejected';
      readonly error: {
        message: string;
        code?: string;
        suggestedTarget?: string;
        suggestedTargets?: string[];
      };
    };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<HandoffDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const handoffEffect = (
  chatroomId: string,
  options: HandoffOptions
): Effect.Effect<void, HandoffError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const { role, message, nextRole } = options;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const result = yield* backend
      .mutation<{
        success: boolean;
        error?: {
          message: string;
          code?: string;
          suggestedTarget?: string;
          suggestedTargets?: string[];
        };
        supportsNativeIntegration?: boolean;
      }>(api.messages.handoff, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: role,
        content: message,
        targetRole: nextRole,
      })
      .pipe(
        Effect.mapError((cause): HandoffError => {
          let errorData: { code?: string; message?: string } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string; message?: string };
          }
          return { _tag: 'HandoffFailed', cause, errorData };
        })
      );

    if (!result.success && result.error) {
      return yield* Effect.fail<HandoffError>({
        _tag: 'HandoffRejected',
        error: result.error,
      });
    }

    const convexUrl = yield* session.getConvexUrl();

    yield* Effect.sync(() => {
      console.log(
        generateHandoffOutput({
          role,
          nextRole,
          chatroomId,
          convexUrl,
          supportsNativeIntegration: result.supportsNativeIntegration,
        })
      );
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleHandoffError(err: HandoffError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
      process.exit(1);
    } else if (err._tag === 'HandoffFailed') {
      console.error(`\n❌ ERROR: Handoff failed`);

      if (err.errorData) {
        console.error(`\n${err.errorData.message || 'An unexpected error occurred'}`);

        if (process.env.CHATROOM_DEBUG === 'true') {
          console.error('\n🔍 Debug Info:');
          console.error(JSON.stringify(err.errorData, null, 2));
        }

        if (err.errorData.code === 'AUTH_FAILED') {
          console.error('\n💡 Try authenticating again:');
          console.error(`   chatroom auth login`);
        } else if (err.errorData.code === 'INVALID_ROLE') {
          console.error('\n💡 Check your team configuration and use a valid role');
        }
      } else {
        console.error(`\n${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);

        if (process.env.CHATROOM_DEBUG === 'true') {
          console.error('\n🔍 Debug Info:');
          console.error(err.cause);
        }
      }

      console.error('\n📚 Need help? Check the docs or run:');
      console.error(`   chatroom handoff --help`);
      process.exit(1);
    } else if (err._tag === 'HandoffRejected') {
      console.error(`\n❌ ERROR: ${err.error.message}`);

      if (err.error.code === 'INVALID_TARGET_ROLE' && err.error.suggestedTargets) {
        console.error(`\n📋 Available handoff targets for this team:`);
        for (const target of err.error.suggestedTargets) {
          console.error(`   • ${target}`);
        }
        console.error(`\n💡 Check your team's handoff rules in the system prompt for valid paths.`);
      } else if (err.error.suggestedTarget) {
        console.error(`\n💡 Try this instead:`);
        console.error('```');
        console.error(`   chatroom handoff --next-role=${err.error.suggestedTarget} ...`);
        console.error('```');
      }
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Complete a task and hand off to the next role
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function handoff(
  chatroomId: string,
  options: HandoffOptions,
  deps?: HandoffDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    handoffEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleHandoffError(err)),
      Effect.provide(layer)
    )
  );

  const sessionId = await d.session.getSessionId();
  if (sessionId) {
    await syncGitAfterUserHandoff(d, sessionId, chatroomId, options.nextRole);
  }
}
