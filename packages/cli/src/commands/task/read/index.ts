/**
 * Read a task and mark it as in_progress
 *
 * This command is the primary way to transition a task from acknowledged →in_progress.
 * It calls the backend readTask mutation which atomically:
 * 1. Validates the task exists and is assigned to the caller's role
 * 2. Transitions the task to in_progress
 * 3. Returns the task content
 * Phase 7: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { TaskReadDeps } from './deps.js';
import { renderTaskPrompt } from './render.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../../infrastructure/services/index.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { TaskReadDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TaskReadOptions {
  role: string;
  taskId: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type TaskReadError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'InvalidTaskId'; readonly id: string }
  | { readonly _tag: 'MutationFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<TaskReadDeps> {
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
 * Build Effect Layer from TaskReadDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: TaskReadDeps): Layer.Layer<BackendService | SessionService> {
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
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const taskReadEffect = (
  chatroomId: string,
  options: TaskReadOptions
): Effect.Effect<void, TaskReadError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const { role, taskId } = options;

    // Get Convex URL for authentication
    const convexUrl = yield* session.getConvexUrl();

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      return yield* Effect.fail<TaskReadError>({
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
      return yield* Effect.fail<TaskReadError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Validate task ID format
    if (!taskId || typeof taskId !== 'string' || taskId.length < 20 || taskId.length > 40) {
      return yield* Effect.fail<TaskReadError>({
        _tag: 'InvalidTaskId',
        id: taskId,
      });
    }

    // Call the readTask mutation
    const result = yield* backend
      .mutation<{
        taskId: string;
        status: string;
        content: string;
        context?: string | null;
        attachedBacklogItems?: unknown[] | null;
      }>(api.tasks.readTask, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role,
        taskId: taskId as Id<'chatroom_tasks'>,
      })
      .pipe(Effect.mapError((cause): TaskReadError => ({ _tag: 'MutationFailed', cause })));

    // Print success message
    yield* Effect.sync(() => {
      console.log(
        renderTaskPrompt({
          taskId: result.taskId,
          status: result.status,
          content: result.content,
          chatroomId,
          role,
          context:
            result.context && typeof result.context === 'object' ? result.context : undefined,
          attachedBacklogItems: Array.isArray(result.attachedBacklogItems)
            ? (result.attachedBacklogItems as { _id: string; content: string; status: string }[])
            : undefined,
        })
      );
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleTaskReadError(err: TaskReadError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom task read ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'InvalidTaskId') {
      console.error(
        `❌ Invalid task ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'MutationFailed') {
      console.error(`❌ Failed to read task`);
      console.error(`   Error: ${err.cause.message}`);

      // Provide helpful hints for common errors
      if (err.cause.message.includes('not found')) {
        console.error(`\n   Verify the task ID is correct and you have access to this chatroom.`);
      } else if (err.cause.message.includes('assigned to')) {
        console.error(`\n   This task is not assigned to your role. Use the correct --role flag.`);
      } else if (err.cause.message.includes('acknowledged')) {
        console.error(`\n   Tasks must be in 'acknowledged' status to be read.`);
        console.error(
          `   If this task is already in_progress, this might be a recovery situation.`
        );
      }

      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ────────────────────────

/**
 * Read a task and mark it as in_progress
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function taskRead(
  chatroomId: string,
  options: TaskReadOptions,
  deps?: TaskReadDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    taskReadEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleTaskReadError(err)),
      Effect.provide(layer)
    )
  );
}
