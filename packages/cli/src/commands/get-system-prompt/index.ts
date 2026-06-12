/**
 * Get System Prompt CLI Command
 *
 * Fetches the full agent system prompt for a given role in a chatroom.
 * Useful for self-refresh after a crash or context compaction.
 * Phase 3: Migrated to Effect-TS services with typed error handling.
 */

import { Effect, Layer } from 'effect';

import type { GetSystemPromptDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { GetSystemPromptDeps } from './deps.js';

export interface GetSystemPromptOptions {
  role: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type GetSystemPromptError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'InvalidChatroomId'; readonly chatroomId: string }
  | { readonly _tag: 'ChatroomNotFound'; readonly chatroomId: string }
  | { readonly _tag: 'BackendError'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<GetSystemPromptDeps> {
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
 * Build Effect Layer from GetSystemPromptDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: GetSystemPromptDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(BackendServiceLive(deps.backend), SessionServiceLive(deps.session));
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const getSystemPromptEffect = (
  chatroomId: string,
  options: GetSystemPromptOptions
): Effect.Effect<void, GetSystemPromptError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const { role } = options;

    // Validate chatroomId
    if (!chatroomId || chatroomId.trim() === '') {
      return yield* Effect.fail<GetSystemPromptError>({
        _tag: 'InvalidChatroomId',
        chatroomId,
      });
    }

    // Get session ID for authentication
    const session = yield* SessionService;
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      return yield* Effect.fail<GetSystemPromptError>({ _tag: 'NotAuthenticated' });
    }

    const convexUrl = yield* session.getConvexUrl();

    // Fetch chatroom data to get team info
    const backend = yield* BackendService;
    const chatroom = yield* backend
      .query<{
        teamId: string;
        teamName: string;
        teamRoles: string[];
        teamEntryPoint: string;
      } | null>(api.chatrooms.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(Effect.mapError((cause): GetSystemPromptError => ({ _tag: 'BackendError', cause })));

    if (!chatroom) {
      return yield* Effect.fail<GetSystemPromptError>({
        _tag: 'ChatroomNotFound',
        chatroomId,
      });
    }

    // Fetch the full agent system prompt
    const prompt = yield* backend
      .query<string>(api.prompts.webapp.getAgentPrompt, {
        chatroomId,
        role,
        teamId: chatroom.teamId,
        teamName: chatroom.teamName,
        teamRoles: chatroom.teamRoles,
        teamEntryPoint: chatroom.teamEntryPoint,
        convexUrl: convexUrl ?? undefined,
      })
      .pipe(Effect.mapError((cause): GetSystemPromptError => ({ _tag: 'BackendError', cause })));

    // Print output (side effect in the Effect monad)
    yield* Effect.sync(() => {
      console.log(prompt);
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleGetSystemPromptError(err: GetSystemPromptError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated. Please run: chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(`❌ Invalid chatroom ID: ${err.chatroomId}`);
      process.exit(1);
    } else if (err._tag === 'ChatroomNotFound') {
      console.error(`❌ Chatroom not found: ${err.chatroomId}`);
      process.exit(1);
    } else {
      console.error(`❌ Error fetching system prompt: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Fetch and print the full agent system prompt for a given role in a chatroom.
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function getSystemPrompt(
  chatroomId: string,
  options: GetSystemPromptOptions,
  deps?: GetSystemPromptDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    getSystemPromptEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleGetSystemPromptError(err)),
      Effect.provide(layer)
    )
  );
}
