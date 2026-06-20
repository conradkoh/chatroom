/**
 * Context commands for understanding chatroom state
 *
 * Includes:
 * - readContext: Read conversation history and task status
 * - newContext: Create a new explicit context (replaces pinned message)
 * - listContexts: List recent contexts for a chatroom
 * - inspectContext: View a specific context with details
 * Phase 5: Migrated to Effect-TS services with typed error handling.
 */

import { Effect } from 'effect';

import type { ContextDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
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
  | { readonly _tag: 'EmptyContent' }
  | {
      readonly _tag: 'ContextNoHandoffSinceLast';
      readonly existingContext: { content: string; createdAt: number; createdBy: string };
    }
  | { readonly _tag: 'ReadContextFailed'; readonly cause: Error }
  | { readonly _tag: 'NewContextFailed'; readonly cause: Error }
  | { readonly _tag: 'ListContextsFailed'; readonly cause: Error }
  | { readonly _tag: 'InspectContextFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<ContextDeps> {
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

    const sessionId = yield* requireSessionIdEffect(() => ({
      _tag: 'NotAuthenticated' as const,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    // Query context
    const context = yield* backend
      .query<{
        messages: {
          _id: string;
          senderRole: string;
          targetRole?: string;
          type: string;
          classification?: string;
          content: string;
          featureTitle?: string;
          taskId?: string;
          taskStatus?: string;
          taskContent?: string;
          attachedTasks?: {
            _id: string;
            content: string;
          }[];
        }[];
        currentContext?: {
          content: string;
          createdBy: string;
          createdAt: number;
        };
        originMessage?: {
          _id: string;
          _creationTime: number;
          featureTitle?: string;
        };
        classification?: string;
        pendingTasksForRole: number;
      }>(api.messages.getContextForRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: options.role,
      })
      .pipe(
        Effect.mapError(
          (cause): ContextError => ({ _tag: 'ReadContextFailed', cause: cause as Error })
        )
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
        if (context.classification) {
          console.log(`   Classification: ${context.classification.toUpperCase()}`);
        }
        if (context.originMessage.featureTitle) {
          console.log(`   Feature: ${context.originMessage.featureTitle}`);
        }
      }

      console.log(`\n📊 Status:`);
      console.log(`   Messages in context: ${context.messages.length}`);
      console.log(`   Pending tasks for ${options.role}: ${context.pendingTasksForRole}`);

      console.log(`\n💬 Chat History:`);
      console.log('─'.repeat(60));

      for (const message of context.messages) {
        // Build the opening <message> tag with attributes
        const toAttr = message.targetRole ? ` to="${message.targetRole}"` : '';
        const classAttr = message.classification
          ? ` classification="${message.classification}"`
          : '';
        console.log(
          `<message id="${message._id}" from="${message.senderRole}"${toAttr} type="${message.type}"${classAttr}>`
        );

        if (message.featureTitle) {
          console.log(`   Feature: ${sanitizeForTerminal(message.featureTitle)}`);
        }

        // Show task info if available
        if (message.taskId) {
          console.log(`   Task:`);
          console.log(`      ID: ${message.taskId}`);
          if (message.taskStatus) {
            console.log(`      Status: ${message.taskStatus}`);
          }
          if (message.taskContent) {
            const safeTaskContent = sanitizeForTerminal(message.taskContent);
            console.log(`      Content:`);
            console.log(`      <task-content>`);
            console.log(
              safeTaskContent
                .split('\n')
                .map((l) => `      ${l}`)
                .join('\n')
            );
            console.log(`      </task-content>`);
          }
        }

        // Show attached tasks if available
        if (message.attachedTasks && message.attachedTasks.length > 0) {
          console.log(`   Attachments:`);
          for (const task of message.attachedTasks) {
            console.log(`      🔹 Task ID: ${task._id}`);
            console.log(`         Type: Task`);
            const contentLines = sanitizeForTerminal(task.content).split('\n');
            console.log(`         Content:`);
            console.log(`         <task-content>`);
            for (const line of contentLines) {
              console.log(`         ${line}`);
            }
            console.log(`         </task-content>`);
          }
        }

        // Show full message content
        console.log(`   Content:`);
        console.log(`   <message-content>`);
        const safeMessageContent = sanitizeForTerminal(message.content);
        console.log(
          safeMessageContent
            .split('\n')
            .map((l) => `      ${l}`)
            .join('\n')
        );
        console.log(`   </message-content>`);
        console.log(`</message>`);
      }

      console.log('\n' + '═'.repeat(60));
      console.log('</context>');
    });
  });

/**
 * Pure Effect program for newContext
 */
// fallow-ignore-next-line unused-export complexity
export const newContextEffect = (
  chatroomId: string,
  options: {
    role: string;
    content: string;
    triggerMessageId?: string;
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

    // Validate content is not empty
    if (!options.content || options.content.trim().length === 0) {
      return yield* Effect.fail<ContextError>({ _tag: 'EmptyContent' });
    }

    // Create context mutation
    const contextId = yield* backend
      .mutation<string>(api.contexts.createContext, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content: options.content,
        role: options.role,
        triggerMessageId: options.triggerMessageId as Id<'chatroom_messages'> | undefined,
      })
      .pipe(
        Effect.catchAll((cause) => {
          // Check for structured ConvexError with a known code
          const errData = (
            cause as {
              data?: {
                code?: string;
                message?: string;
                existingContext?: { content: string; createdAt: number; createdBy: string };
              };
            }
          ).data;

          if (
            errData?.code === 'CONTEXT_NO_HANDOFF_SINCE_LAST_CONTEXT' &&
            errData.existingContext
          ) {
            return Effect.fail<ContextError>({
              _tag: 'ContextNoHandoffSinceLast',
              existingContext: errData.existingContext,
            });
          }

          return Effect.fail<ContextError>({
            _tag: 'NewContextFailed',
            cause: cause as Error,
          });
        })
      );

    // Print success
    yield* Effect.sync(() => {
      console.log(`✅ Context created successfully`);
      console.log(`   Context ID: ${contextId}`);
      console.log(`   Created by: ${options.role}`);
      console.log(`\n📌 This context is now pinned for all agents in this chatroom.`);
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
    limit?: number;
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
        Effect.mapError(
          (cause): ContextError => ({ _tag: 'ListContextsFailed', cause: cause as Error })
        )
      );

    // Print contexts
    yield* Effect.sync(() => {
      if (contexts.length === 0) {
        console.log(`\n📭 No contexts found for this chatroom`);
        console.log(`\n💡 Create a context with:`);
        console.log(
          `   chatroom context new --chatroom-id=${chatroomId} --role=${options.role} --content="Your context summary"`
        );
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
        Effect.mapError(
          (cause): ContextError => ({ _tag: 'InspectContextFailed', cause: cause as Error })
        )
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

      // Staleness warnings: soft >= 4h, hard >= 24h
      if (context.elapsedHours >= 24) {
        console.log(`\n⚠️  This context is over 24 hours old.`);
        console.log(`   Consider creating a new context with an updated summary.`);
      } else if (context.elapsedHours >= 4) {
        console.log(`\n⚠️  This context is over 4 hours old.`);
        console.log(`   Consider refreshing if the focus has shifted.`);
      }

      console.log(`\n📝 Content:`);
      console.log('─'.repeat(60));
      console.log(sanitizeForTerminal(context.content));
      console.log('─'.repeat(60));

      console.log(`\n💡 To create a new context:`);
      console.log(
        `   chatroom context new --chatroom-id=${chatroomId} --role=${options.role} --content="Your updated summary"`
      );

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
    } else if (err._tag === 'EmptyContent') {
      console.error(`❌ Context content cannot be empty`);
      process.exit(1);
    } else if (err._tag === 'ContextNoHandoffSinceLast') {
      const { content, createdAt, createdBy } = err.existingContext;
      console.error(
        `❌ Cannot create new context: no handoff sent since last context was created.`
      );
      console.error(`\n📌 Current Context (resume from here):`);
      console.error(`   Created by: ${sanitizeForTerminal(createdBy)}`);
      console.error(`   Created at: ${new Date(createdAt).toLocaleString()}`);
      console.error(`   Content:`);
      const safeContent = sanitizeForTerminal(content);
      console.error(
        safeContent
          .split('\n')
          .map((l) => `      ${l}`)
          .join('\n')
      );
      console.error(`\n💡 Send a handoff first, then create a new context.`);
      process.exit(1);
    } else if (err._tag === 'ReadContextFailed') {
      console.error(`❌ Failed to read context: ${sanitizeUnknownForTerminal(err.cause.message)}`);
      process.exit(1);
    } else if (err._tag === 'NewContextFailed') {
      console.error(`❌ Failed to create context: ${err.cause.message}`);
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
      Effect.catchAll((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Create a new explicit context for a chatroom.
 * This replaces the pinned message system with explicit context management.
 */
export async function newContext(
  chatroomId: string,
  options: {
    role: string;
    content: string;
    triggerMessageId?: string;
  },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    newContextEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleContextError(err)),
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
    limit?: number;
  },
  deps?: ContextDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    listContextsEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Print the context template to stdout.
 */
export function viewTemplate(): string {
  return `## Goal
<user-centric goal: what the user wants>
<development-centric goal: what we are building/changing>

## Requirements
- <outcome or requirement>

## Structure
- <concrete folder structure, architecture style (e.g. vertical slice + clean architecture), key shape decisions>

## Avoid
- <thing to not do / out of scope>`;
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
      Effect.catchAll((err) => handleContextError(err)),
      Effect.provide(layer)
    )
  );
}
