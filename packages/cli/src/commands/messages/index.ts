/**
 * Messages commands for listing and filtering chatroom messages
 *
 * Phase 8: Migrated to Effect-TS services with typed error handling.
 */

import { Effect } from 'effect';

import type { MessagesDeps } from './deps.js';
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

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { MessagesDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ListBySenderRoleOptions {
  role: string;
  senderRole: string;
  limit?: number;
  full?: boolean;
}

export interface ListSinceMessageOptions {
  role: string;
  sinceMessageId: string;
  limit?: number;
  full?: boolean;
}

/** Shared shape for messages returned from the backend */
type MessageItem = {
  _id: string;
  _creationTime: number;
  type: string;
  content: string;
  senderRole: string;
  targetRole: string | null;
  classification: string | null;
  taskStatus: string | null;
  featureTitle: string | null;
};

// ─── Domain errors ─────────────────────────────────────────────────────────

export type MessagesError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<MessagesDeps> {
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

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Format classification and status badges for a message */
function formatBadges(message: MessageItem): string {
  const classification = message.classification ? ` [${message.classification.toUpperCase()}]` : '';
  const status = message.taskStatus ? ` (${message.taskStatus})` : '';
  return `${classification}${status}`;
}

/** Log message content, truncated or full based on the option */
function logMessageContent(content: string, full: boolean): void {
  if (full) {
    console.log(
      `   Content:\n${content
        .split('\n')
        .map((l: string) => `   ${l}`)
        .join('\n')}`
    );
  } else {
    const firstLine = content.split('\n')[0];
    const truncated = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
    console.log(`   Content: ${truncated}`);
  }
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program for listing messages by sender role.
 * No process.exit, no console.error inside — typed errors only.
 */
// fallow-ignore-next-line unused-export
export const listBySenderRoleEffect = (
  chatroomId: string,
  options: ListBySenderRoleOptions
): Effect.Effect<void, MessagesError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const messages = yield* backend
      .query<MessageItem[]>(api.messages.listBySenderRole, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: options.senderRole,
        limit: options.limit || 10,
      })
      .pipe(Effect.mapError((cause): MessagesError => ({ _tag: 'QueryFailed', cause })));

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      if (messages.length === 0) {
        console.log(`\n📭 No messages found for sender role: ${options.senderRole}`);
        return;
      }

      console.log(`\n📨 Messages from ${options.senderRole} (${messages.length} found):`);
      console.log('─'.repeat(60));

      for (const message of messages) {
        const timestamp = new Date(message._creationTime).toLocaleString();
        const badges = formatBadges(message);

        console.log(`\n🔹 ID: ${message._id}`);
        console.log(`   Time: ${timestamp}`);
        console.log(`   Type: ${message.type}${badges}`);
        if (message.targetRole) {
          console.log(`   Target: ${message.targetRole}`);
        }
        if (message.featureTitle) {
          console.log(`   Title: ${message.featureTitle}`);
        }

        logMessageContent(message.content, options.full ?? false);
      }

      console.log('\n' + '─'.repeat(60));
      console.log(`💡 Use --full to see complete message content`);
      console.log(`💡 Use --since-message-id=<id> to get all messages since a specific message`);
    });
  });

/**
 * Pure Effect program for listing messages since a given message ID.
 * No process.exit, no console.error inside — typed errors only.
 */
// fallow-ignore-next-line unused-export
export const listSinceMessageEffect = (
  chatroomId: string,
  options: ListSinceMessageOptions
): Effect.Effect<void, MessagesError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const messages = yield* backend
      .query<MessageItem[]>(api.messages.listSinceMessage, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        sinceMessageId: options.sinceMessageId as Id<'chatroom_messages'>,
        limit: options.limit || 100,
      })
      .pipe(Effect.mapError((cause): MessagesError => ({ _tag: 'QueryFailed', cause })));

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      if (messages.length === 0) {
        console.log(`\n📭 No messages found since message: ${options.sinceMessageId}`);
        return;
      }

      console.log(`\n📨 Messages since ${options.sinceMessageId} (${messages.length} found):`);
      console.log('─'.repeat(60));

      for (const message of messages) {
        const timestamp = new Date(message._creationTime).toLocaleString();
        const roleIndicator = message.senderRole.toLowerCase() === 'user' ? '👤' : '🤖';
        const badges = formatBadges(message);

        console.log(
          `\n${roleIndicator} ${message.senderRole}${message.targetRole ? ` → ${message.targetRole}` : ''}`
        );
        console.log(`   ID: ${message._id}`);
        console.log(`   Time: ${timestamp}`);
        console.log(`   Type: ${message.type}${badges}`);
        if (message.featureTitle) {
          console.log(`   Title: ${message.featureTitle}`);
        }

        logMessageContent(message.content, options.full ?? false);
      }

      console.log('\n' + '─'.repeat(60));
      console.log(`💡 Use --full to see complete message content`);
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleMessagesError(err: MessagesError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom messages list ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'QueryFailed') {
      console.error(`\n❌ Error fetching messages: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

// ─── Entry Points (public API — unchanged signatures) ─────────────────────

/**
 * List messages filtered by sender role
 * Uses the composite index for efficient filtering
 */
export async function listBySenderRole(
  chatroomId: string,
  options: ListBySenderRoleOptions,
  deps?: MessagesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    listBySenderRoleEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleMessagesError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * List all messages since a given message ID (inclusive)
 * Returns messages in ascending order (oldest first)
 */
export async function listSinceMessage(
  chatroomId: string,
  options: ListSinceMessageOptions,
  deps?: MessagesDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    listSinceMessageEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleMessagesError(err)),
      Effect.provide(layer)
    )
  );
}
