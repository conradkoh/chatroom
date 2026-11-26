/**
 * Context commands for understanding chatroom state
 *
 * Includes:
 * - readContext: Read conversation history and task status
 * - listContexts: List recent contexts for a chatroom
 * - inspectContext: View a specific context with details
 * Phase 5: Migrated to Effect-TS services with typed error handling.
 */

// Error handlers mirror the sibling CLI commands by design.
// fallow-ignore-file code-duplication
import type { Message } from '@workspace/backend/src/domain/entities/message';
import { serializeMessage } from '@workspace/backend/src/domain/usecase/message/serialize-message';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect } from 'effect';

import type { ContextDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';
import { sanitizeForTerminal, sanitizeUnknownForTerminal } from '../../utils/terminal-safety.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { ContextDeps } from './deps.js';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type ContextError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'ReadContextFailed'; readonly cause: Error }
  | { readonly _tag: 'ListContextsFailed'; readonly cause: Error }
  | { readonly _tag: 'InspectContextFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ContextDeps> {
  return createConvexCommandDeps();
}

function requireAuthenticatedChatroom(
  chatroomId: string
): Effect.Effect<SessionId, ContextError, BackendService | SessionService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionIdEffect(() => ({
      _tag: 'NotAuthenticated' as const,
    }));
    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));
    return sessionId;
  });
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for readContext — no process.exit, no console.error inside.
 */
// fallow-ignore-next-line unused-export complexity
export const readContextEffect = (
  chatroomId: string,
  options: { role: string }
): Effect.Effect<void, ContextError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireAuthenticatedChatroom(chatroomId);

    // Query context
    const context = yield* backend
      .query<{
        messages: Message[];
        currentContext?:
          | {
              content: string;
              createdBy: string;
              createdAt: number;
            }
          | undefined;
        originMessage?:
          | {
              _id: string;
              _creationTime: number;
            }
          | undefined;
        pendingTasksForRole: number;
      }>(api.messages.getContextForRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: options.role,
      })
      .pipe(
        Effect.mapError((cause): ContextError => ({
          _tag: 'ReadContextFailed',
          cause: cause as Error,
        }))
      );

    // Print context
    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      if (context.messages.length === 0 && !context.currentContext) {
        console.log(`<context role="${options.role}">`);
        console.log(`\n📭 No context available`);
        console.log('</context>');
        return;
      }

      console.log(`<context role="${options.role}">`);
      console.log(`\n📚 CONTEXT FOR ${options.role.toUpperCase()}`);
      console.log('═'.repeat(60));

      // Display the pinned context if available
      if (context.currentContext) {
        console.log(`\n📌 Current Context:`);
        console.log(`   Created by: ${context.currentContext.createdBy}`);
        console.log(
          `   Created at: ${new Date(context.currentContext.createdAt).toLocaleString()}`
        );
        console.log(`   Content:`);
        const safeContextContent = sanitizeForTerminal(context.currentContext.content);
        console.log(
          safeContextContent
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n')
        );
        console.log('─'.repeat(60));
      }

      if (context.originMessage) {
        console.log(`\n🎯 Origin Message:`);
        console.log(`   ID: ${context.originMessage._id}`);
        console.log(`   Time: ${new Date(context.originMessage._creationTime).toLocaleString()}`);
      }

      console.log(`\n📊 Status:`);
      console.log(`   Messages in context: ${context.messages.length}`);
      console.log(`   Pending tasks for ${options.role}: ${context.pendingTasksForRole}`);

      console.log(`\n💬 Chat History:`);
      console.log('─'.repeat(60));

      for (const message of context.messages) {
        const serialized = serializeMessage(message, {
          profile: 'context-xml',
          chatroomId,
          role: options.role,
        });
        console.log(sanitizeForTerminal(serialized));
      }

      console.log('\n' + '═'.repeat(60));
      console.log('</context>');
    });
  });

/**
 * Pure Effect program for listContexts
 */
// fallow-ignore-next-line unused-export complexity
export const listContextsEffect = (
  chatroomId: string,
  options: {
    role: string;
    limit?: number | undefined;
  }
): Effect.Effect<void, ContextError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect(() => ({
      _tag: 'NotAuthenticated' as const,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    // Query contexts
    const contexts = yield* backend
      .query<
        {
          _id: string;
          createdBy: string;
          createdAt: number;
          content: string;
        }[]
      >(api.contexts.listContexts, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        limit: options.limit ?? 10,
      })
      .pipe(
        Effect.mapError((cause): ContextError => ({
          _tag: 'ListContextsFailed',
          cause: cause as Error,
        }))
      );

    // Print contexts
    yield* Effect.sync(() => {
      if (contexts.length === 0) {
        console.log(`\n📭 No contexts found for this chatroom`);
        return;
      }

      console.log(`\n📚 CONTEXTS (${contexts.length} found)`);
      console.log('═'.repeat(60));

      for (const context of contexts) {
        const timestamp = new Date(context.createdAt).toLocaleString();

        console.log(`\n🔹 Context ID: ${context._id}`);
        console.log(`   Created by: ${context.createdBy}`);
        console.log(`   Created at: ${timestamp}`);
        console.log(`   Content:`);
        // Truncate to first 200 chars for list view
        const safeContent = sanitizeForTerminal(context.content);
        const truncatedContent =
          safeContent.length > 200 ? safeContent.slice(0, 200) + '...' : safeContent;
        console.log(
          truncatedContent
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n')
        );
      }

      console.log('\n' + '═'.repeat(60));
    });
  });

/**
 * Pure Effect program for inspectContext
 */
// fallow-ignore-next-line unused-export complexity
export const inspectContextEffect = (
  chatroomId: string,
  options: {
    role: string;
    contextId: string;
  }
): Effect.Effect<void, ContextError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect(() => ({
      _tag: 'NotAuthenticated' as const,
    }));

    // Query context
    const context = yield* backend
      .query<{
        _id: string;
        createdBy: string;
        createdAt: number;
        content: string;
        elapsedHours: number;
      }>(api.contexts.getContext, {
        sessionId,
        contextId: options.contextId as Id<'chatroom_contexts'>,
      })
      .pipe(
        Effect.mapError((cause): ContextError => ({
          _tag: 'InspectContextFailed',
          cause: cause as Error,
        }))
      );

    // Print context
    yield* Effect.sync(() => {
      console.log(`\n📋 CONTEXT DETAILS`);
      console.log('═'.repeat(60));

      console.log(`\n🔹 Context ID: ${context._id}`);
      console.log(`   Created by: ${context.createdBy}`);
      console.log(`   Created at: ${new Date(context.createdAt).toLocaleString()}`);

      // Staleness information (time-based only)
      console.log(`\n📊 Staleness:`);
      console.log(`   Time elapsed: ${context.elapsedHours.toFixed(1)} hours`);

      console.log(`\n📝 Content:`);
      console.log('─'.repeat(60));
      console.log(sanitizeForTerminal(context.content));
      console.log('─'.repeat(60));

      console.log('\n' + '═'.repeat(60));
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 */
// fallow-ignore-next-line complexity
function handleContextError(err: ContextError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated. Please run: chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'ReadContextFailed') {
      console.error(`❌ Failed to read context: ${sanitizeUnknownForTerminal(err.cause.message)}`);
      process.exit(1);
    } else if (err._tag === 'ListContextsFailed') {
      console.error(`❌ Failed to list contexts: ${sanitizeUnknownForTerminal(err.cause.message)}`);
      process.exit(1);
    } else if (err._tag === 'InspectContextFailed') {
      console.error(
        `❌ Failed to inspect context: ${sanitizeUnknownForTerminal(err.cause.message)}`
      );
      process.exit(1);
    }
  });
}

// ─── Entry Points (public API — unchanged signatures) ────────────────────

/**
 * Read context for a specific role.
 * Shows recent conversation history with task information.
 */
export async function readContext(
  chatroomId: string,
  options: { role: string },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    readContextEffect(chatroomId, options).pipe(
      Effect.catch((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * List recent contexts for a chatroom.
 */
export async function listContexts(
  chatroomId: string,
  options: {
    role: string;
    limit?: number | undefined;
  },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    listContextsEffect(chatroomId, options).pipe(
      Effect.catch((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Inspect a specific context with staleness information.
 */
export async function inspectContext(
  chatroomId: string,
  options: {
    role: string;
    contextId: string;
  },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    inspectContextEffect(chatroomId, options).pipe(
      Effect.catch((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}
