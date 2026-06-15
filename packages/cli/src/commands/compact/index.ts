/**
 * Compact command — self-composition for remote agents.
 *
 * Allows a remote agent to trigger its own compaction by:
 * 1. Validating the agent is a remote agent (not a subagent)
 * 2. Stopping the agent for the team + role
 * 3. Inserting a compaction message into the chatroom
 *
 * The agent reads a compaction template from stdin containing:
 * - Goal (user-centric + development-centric)
 * - Requirements
 * - Structure (folder structure, architecture decisions)
 * - Avoid (out of scope)
 *
 * Phase: Implemented as part of backlog #13 (Self-composition for remote agents).
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect, Layer } from 'effect';

import type { CompactDeps } from './deps.js';
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

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { CompactDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CompactOptions {
  role: string;
  content: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type CompactError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'NotRemoteAgent' }
  | {
      readonly _tag: 'CompactFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string; message?: string };
    }
  | { readonly _tag: 'AgentStopFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<CompactDeps> {
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

// fallow-ignore-next-line complexity
function layerFromDeps(
  deps: CompactDeps
): Layer.Layer<BackendService | SessionService, never, never> {
  // fallow-ignore-next-line @typescript-eslint/no-explicit-any
  const backendOps = {
    // fallow-ignore-next-line @typescript-eslint/no-explicit-any
    query: deps.backend.query as (e: any, a: any) => Promise<any>,
    // fallow-ignore-next-line @typescript-eslint/no-explicit-any
    mutation: deps.backend.mutation as (e: any, a: any) => Promise<any>,
  };

  const sessionOps = {
    // fallow-ignore-next-line @typescript-eslint/no-explicit-any
    getSessionId: deps.session.getSessionId as () => Promise<SessionId | null>,
    getConvexUrl: deps.session.getConvexUrl as () => string,
    getOtherSessionUrls: deps.session.getOtherSessionUrls as () => Promise<string[]>,
  };

  return Layer.mergeAll(BackendServiceLive(backendOps), SessionServiceLive(sessionOps));
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const compactEffect = (
  chatroomId: string,
  options: CompactOptions
): Effect.Effect<void, CompactError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const { role, content } = options;

    // Get session ID for authentication
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      const otherUrls = yield* session.getOtherSessionUrls();
      const convexUrl = yield* session.getConvexUrl();
      return yield* Effect.fail<CompactError>({
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
      return yield* Effect.fail<CompactError>({
        _tag: 'InvalidChatroomId',
        id: chatroomId,
      });
    }

    // Validate content is not empty
    if (!content || content.trim().length === 0) {
      return yield* Effect.fail<CompactError>({
        _tag: 'CompactFailed',
        cause: new Error('Compaction content cannot be empty'),
      });
    }

    // Execute compact mutation
    const result = yield* backend
      .mutation<{ success: boolean; error?: { message: string; code?: string } }>(
        api.messages.compact,
        {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          role,
          content,
        }
      )
      .pipe(
        Effect.mapError((cause): CompactError => {
          // Extract Convex error data if available
          let errorData: { code?: string; message?: string } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string; message?: string };
          }

          // Check for not-a-remote-agent error
          if (errorData?.code === 'NOT_REMOTE_AGENT') {
            return { _tag: 'NotRemoteAgent' };
          }

          return { _tag: 'CompactFailed', cause, errorData };
        })
      );

    // Check for compact restriction errors
    if (!result.success && result.error) {
      return yield* Effect.fail<CompactError>({
        _tag: 'CompactFailed',
        cause: new Error(result.error.message),
        errorData: result.error.code
          ? { code: result.error.code, message: result.error.message }
          : undefined,
      });
    }
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleCompactError(err: CompactError): Effect.Effect<void> {
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
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom compact ...`);
      }
      console.error(`\n   Or to authenticate for the current environment:`);
      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'NotRemoteAgent') {
      console.error(`❌ Self-composition is only available for remote agents, not subagents.`);
      console.error(`\n💡 Register your agent as a remote agent:`);
      console.error(`   chatroom register-agent --chatroom-id=<id> --role=<role> --type=remote`);
      process.exit(1);
    } else if (err._tag === 'CompactFailed') {
      console.error(`\n❌ ERROR: Compact failed`);

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
      console.error(`   chatroom compact --help`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Compact (self-composition) — stop the current agent and insert a compaction message.
 *
 * Reads a compaction template from stdin containing goal, requirements, structure, and avoid sections.
 */
export async function compact(
  chatroomId: string,
  options: CompactOptions,
  deps?: CompactDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    compactEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleCompactError(err)),
      Effect.provide(layer)
    )
  );
}
