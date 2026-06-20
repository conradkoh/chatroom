/**
 * Classify command — classify a task's origin message (entry-point role only)
 *
 * This command is reserved for the entry-point role. It performs
 * the classification logic for the origin message.
 *
 * Entry-point roles: Use this when you receive a user message and need to classify it.
 * Other roles: Classification is not needed — use `task read` to mark in_progress.
 * Phase 4: Migrated to Effect-TS services with typed error handling.
 */

import { Effect } from 'effect';

import type { ClassifyDeps } from './deps.js';
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
import { getErrorMessage } from '../../utils/convex-error.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ClassifyDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ClassifyOptions {
  role: string;
  originMessageClassification: 'question' | 'new_feature' | 'follow_up';
  taskId: string;
  rawStdin?: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type ClassifyError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'ChatroomNotFound'; readonly chatroomId: string }
  | { readonly _tag: 'NotEntryPointRole'; readonly role: string; readonly entryPoint: string }
  | { readonly _tag: 'MissingStdin' }
  | { readonly _tag: 'MissingTaskId' }
  | { readonly _tag: 'TaskNotFound'; readonly taskId: string }
  | { readonly _tag: 'ClassifyFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ClassifyDeps> {
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
export const classifyEffect = (
  chatroomId: string,
  options: ClassifyOptions
): Effect.Effect<void, ClassifyError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const { role, originMessageClassification, rawStdin, taskId } = options;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const convexUrl = yield* session.getConvexUrl();

    // Fetch the chatroom to get its configuration (for entry point check)
    const chatroom = yield* backend
      .query<{
        teamEntryPoint?: string;
        teamRoles?: string[];
      }>(api.chatrooms.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(Effect.mapError((cause): ClassifyError => ({ _tag: 'ClassifyFailed', cause })));

    if (!chatroom) {
      return yield* Effect.fail<ClassifyError>({
        _tag: 'ChatroomNotFound',
        chatroomId,
      });
    }

    // Determine the entry point role
    const entryPoint = chatroom?.teamEntryPoint ?? chatroom?.teamRoles?.[0];

    // Validate: user's role must be the entry point role
    if (entryPoint && role.toLowerCase() !== entryPoint.toLowerCase()) {
      return yield* Effect.fail<ClassifyError>({
        _tag: 'NotEntryPointRole',
        role,
        entryPoint,
      });
    }

    // Validate new_feature requirements
    if (originMessageClassification === 'new_feature') {
      if (!rawStdin || rawStdin.trim().length === 0) {
        return yield* Effect.fail<ClassifyError>({ _tag: 'MissingStdin' });
      }
    }

    // Find the target task to acknowledge
    if (!taskId) {
      return yield* Effect.fail<ClassifyError>({ _tag: 'MissingTaskId' });
    }

    // Fetch the specific task by ID directly
    const targetTask = yield* backend
      .query<{ content: string } | null>(api.tasks.getTask, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        taskId: taskId as Id<'chatroom_tasks'>,
      })
      .pipe(Effect.mapError((cause): ClassifyError => ({ _tag: 'ClassifyFailed', cause })));

    if (!targetTask) {
      return yield* Effect.fail<ClassifyError>({
        _tag: 'TaskNotFound',
        taskId,
      });
    }

    // Classify the message (requires task to be in_progress)
    // This is only for entry point roles receiving user messages
    const result = yield* backend
      .mutation<{ reminder?: string }>(api.messages.taskStarted, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        taskId: taskId as Id<'chatroom_tasks'>,
        originMessageClassification: originMessageClassification,
        convexUrl: convexUrl,
        ...(rawStdin && { rawStdin }),
      })
      .pipe(Effect.mapError((cause): ClassifyError => ({ _tag: 'ClassifyFailed', cause })));

    // Print success message
    yield* Effect.sync(() => {
      console.log(`✅ Task acknowledged and classified`);
      console.log(`   Classification: ${originMessageClassification}`);
      console.log(`   Task: ${targetTask.content}`);

      // Display the focused reminder from the backend
      if (result.reminder) {
        console.log(`\n💡 ${result.reminder}`);
      }
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleClassifyError(err: ClassifyError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom classify ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'ChatroomNotFound') {
      console.error(`❌ Chatroom not found: ${err.chatroomId}`);
      console.error(`   Verify the chatroom ID is correct and you have access.`);
      process.exit(1);
    } else if (err._tag === 'NotEntryPointRole') {
      console.error(
        `❌ \`classify\` is only available to the entry point role (${err.entryPoint}). Your role is ${err.role}.`
      );
      console.error('');
      console.error('   Entry point roles receive user messages and must classify them.');
      console.error('   Other roles receive handoffs — use `task read` to mark in_progress.');
      process.exit(1);
    } else if (err._tag === 'MissingStdin') {
      console.error(`❌ new_feature classification requires stdin with feature metadata`);
      console.error('   Provide structured stdin with TITLE, DESCRIPTION, and TECH_SPECS');
      console.error('');
      console.error('   Example:');
      console.error(
        `   echo '---TITLE---\nFeature title\n---DESCRIPTION---\nWhat this feature does\n---TECH_SPECS---\nHow to implement it' | chatroom classify ...`
      );
      process.exit(1);
    } else if (err._tag === 'MissingTaskId') {
      console.error(`❌ --task-id is required for classify`);
      console.error(
        `   Usage: chatroom classify --chatroom-id=<id> --role=<role> --task-id=<id> --classification=<type>`
      );
      process.exit(1);
    } else if (err._tag === 'TaskNotFound') {
      console.error(`❌ Task with ID "${err.taskId}" not found in this chatroom`);
      console.error(`   Verify the task ID is correct and you have access to this chatroom`);
      process.exit(1);
    } else if (err._tag === 'ClassifyFailed') {
      console.error(`❌ Failed to acknowledge task`);
      console.error(`   Error: ${getErrorMessage(err.cause)}`);

      // Try to extract more details from the error if available
      if (err.cause instanceof Error && err.cause.stack) {
        const stackLines = err.cause.stack.split('\n').slice(0, 5);
        console.error(`   Stack trace:`);
        stackLines.forEach((line) => console.error(`     ${line}`));
      }

      // Check if this is a Convex error with more details
      if (typeof err.cause === 'object' && err.cause !== null && 'data' in err.cause) {
        const errData = (err.cause as { data: unknown }).data;
        if (errData) {
          console.error(`   Server details:`, JSON.stringify(errData, null, 2));
        }
      }

      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Classify a task's origin message
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function classify(
  chatroomId: string,
  options: ClassifyOptions,
  deps?: ClassifyDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    classifyEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleClassifyError(err)),
      Effect.provide(layer)
    )
  );
}
