/**
 * Report progress on the current task without completing it
 *
 * This command allows agents to send status updates during long-running operations.
 * Progress messages are visible in the webapp but do not trigger handoffs or task changes.
 * Phase 5: Migrated to Effect-TS services with typed error handling.
 */

import { ConvexError } from 'convex/values';
import { Effect, Layer } from 'effect';

import type { ReportProgressDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ReportProgressDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ReportProgressOptions {
  role: string;
  message: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type ReportProgressError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'EmptyMessage' }
  | {
      readonly _tag: 'ReportProgressFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string; message?: string };
    };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ReportProgressDeps> {
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

/**
 * Build Effect Layer from ReportProgressDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: ReportProgressDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(
    BackendServiceLive({
      query: deps.backend.query,
      mutation: deps.backend.mutation,
    }),
    SessionServiceLive({
      getSessionId: deps.session.getSessionId,
      getConvexUrl: deps.session.getConvexUrl,
      getOtherSessionUrls: deps.session.getOtherSessionUrls,
    })
  );
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 */
// fallow-ignore-next-line unused-export complexity
export const reportProgressEffect = (
  chatroomId: string,
  options: ReportProgressOptions
): Effect.Effect<void, ReportProgressError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const { role, message } = options;

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      const convexUrl = yield* session.getConvexUrl();
      return yield* Effect.fail<ReportProgressError>({
        _tag: 'NotAuthenticated',
        convexUrl,
        otherUrls,
      });
    }

    // Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      return yield* Effect.fail<ReportProgressError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Validate message is not empty
    if (!message || message.trim().length === 0) {
      return yield* Effect.fail<ReportProgressError>({ _tag: 'EmptyMessage' });
    }

    // Call the reportProgress mutation
    const result = yield* backend
      .mutation<{ success: boolean }>(api.messages.reportProgress, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: role,
        content: message,
      })
      .pipe(
        Effect.mapError((cause): ReportProgressError => {
          // Extract Convex error data if available
          let errorData: { code?: string; message?: string } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string; message?: string };
          }
          return { _tag: 'ReportProgressFailed', cause: cause as Error, errorData };
        })
      );

    // Print success output
    yield* Effect.sync(() => {
      if (result.success) {
        console.log(`✅ Progress reported`);
        console.log(`📋 ${message}`);
      }
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 */
// fallow-ignore-next-line complexity
function handleReportProgressError(err: ReportProgressError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
      process.exit(1);
    } else if (err._tag === 'EmptyMessage') {
      formatError('Progress message cannot be empty', [
        'Provide a message via stdin',
        "Example: chatroom report-progress <id> --role=builder << 'EOF'",
        'Your message here',
        'EOF',
      ]);
      process.exit(1);
    } else if (err._tag === 'ReportProgressFailed') {
      console.error(`\n❌ ERROR: Failed to report progress`);

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
        } else if (err.errorData.code === 'INVALID_CONTENT') {
          console.error('\n💡 Provide a non-empty message');
        }
      } else {
        console.error(`\n${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);

        if (process.env.CHATROOM_DEBUG === 'true') {
          console.error('\n🔍 Debug Info:');
          console.error(err.cause);
        }
      }

      console.error('\n📚 Need help? Check the docs or run:');
      console.error(`   chatroom report-progress --help`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

export async function reportProgress(
  chatroomId: string,
  options: ReportProgressOptions,
  deps?: ReportProgressDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    reportProgressEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleReportProgressError(err)),
      Effect.provide(layer)
    )
  );
}
