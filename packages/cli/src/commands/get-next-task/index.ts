/**
 * Get Next Task Command — entry point.
 *
 * Handles all pre-flight validation (auth, chatroom access, participant join,
 * init prompt) and then delegates to `GetNextTaskSession.start()`.
 * Phase 11: Migrated to Effect-TS with typed errors and injected session service.
 */

import { getNextTaskGuidance, getNextTaskReminder } from '@workspace/backend/prompts/cli/index.js';
import { getCliEnvPrefix } from '@workspace/backend/prompts/utils/env.js';
import { Effect, Layer } from 'effect';

import { GetNextTaskSessionService } from './get-next-task-session-service.js';
import { GetNextTaskSession } from './session.js';
import { api, type Id } from '../../api.js';
import { getOtherSessionUrls, getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import { getMachineId } from '../../infrastructure/machine/index.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';
import { formatConnectivityError, isNetworkError } from '../../utils/error-formatting.js';

// ─── Re-exports ─────────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type { SessionParams, GetNextTaskResponse } from './session.js';
// fallow-ignore-next-line unused-export
export { GetNextTaskSession } from './session.js';
// fallow-ignore-next-line unused-export
export { GetNextTaskSessionService } from './get-next-task-session-service.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GetNextTaskOptions {
  role: string;
  silent?: boolean;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type GetNextTaskError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'NotAuthorized'; readonly cause: Error }
  | { readonly _tag: 'JoinFailed'; readonly cause: Error }
  | { readonly _tag: 'SessionFailed'; readonly cause: Error };

// ─── Layer Factory ──────────────────────────────────────────────────────────

/**
 * Build Effect layers from module-level defaults (for the production entry point).
 */
async function buildDefaultLayer(): Promise<
  Layer.Layer<BackendService | SessionService | GetNextTaskSessionService>
> {
  const client = await getConvexClient();
  return Layer.mergeAll(
    BackendServiceLive({
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    }),
    SessionServiceLive({
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    }),
    Layer.succeed(GetNextTaskSessionService, {
      createSession: (params) => new GetNextTaskSession(params),
    })
  );
}

// ─── Effect Program ────────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit inside.
 * All errors are typed; caller (handleGetNextTaskError) decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const getNextTaskEffect = (
  chatroomId: string,
  options: GetNextTaskOptions
): Effect.Effect<
  void,
  GetNextTaskError,
  BackendService | SessionService | GetNextTaskSessionService
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionFactory = yield* GetNextTaskSessionService;

    // 1. Get session ID (auth check)
    const sessionId = yield* sessionService.getSessionId();
    if (!sessionId) {
      const convexUrl = yield* sessionService.getConvexUrl();
      const otherUrls = yield* sessionService.getOtherSessionUrls();
      yield* Effect.sync(() => {
        console.error(`❌ Not authenticated for: ${convexUrl}`);
        if (otherUrls.length > 0) {
          console.error(`\n💡 You have sessions for other environments:`);
          for (const url of otherUrls) {
            console.error(`   • ${url}`);
          }
          console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
          console.error(`   CHATROOM_CONVEX_URL=${otherUrls[0]} chatroom get-next-task ...`);
          console.error(`\n   Or to authenticate for the current environment:`);
        }
        console.error(`   chatroom auth login`);
      });
      return yield* Effect.fail<GetNextTaskError>({ _tag: 'NotAuthenticated' });
    }

    // 2. Get Convex URL and CLI env prefix
    const convexUrl = yield* sessionService.getConvexUrl();
    const cliEnvPrefix = getCliEnvPrefix(convexUrl);

    // 3. Validate chatroom ID format
    if (
      !chatroomId ||
      typeof chatroomId !== 'string' ||
      chatroomId.length < 20 ||
      chatroomId.length > 40
    ) {
      yield* Effect.sync(() => {
        console.error(
          `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
        );
      });
      return yield* Effect.fail<GetNextTaskError>({
        _tag: 'NotAuthorized',
        cause: new Error('Invalid chatroom ID format'),
      });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(chatroomId)) {
      yield* Effect.sync(() => {
        console.error(
          `❌ Invalid chatroom ID format: ID must contain only alphanumeric characters and underscores`
        );
      });
      return yield* Effect.fail<GetNextTaskError>({
        _tag: 'NotAuthorized',
        cause: new Error('Invalid chatroom ID characters'),
      });
    }

    // 4. Validate chatroom exists and user has access
    const chatroom = yield* backend
      .query<Record<string, unknown> | null>(api.chatrooms.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(
        Effect.catchAll((e) => {
          const cause = e instanceof Error ? e : new Error(String(e));
          if (isNetworkError(e)) {
            formatConnectivityError(e, convexUrl);
          }
          return Effect.fail<GetNextTaskError>({ _tag: 'NotAuthorized', cause });
        })
      );

    if (!chatroom) {
      yield* Effect.sync(() => {
        console.error(`❌ Chatroom ${chatroomId} not found or access denied`);
      });
      return yield* Effect.fail<GetNextTaskError>({
        _tag: 'NotAuthorized',
        cause: new Error('Chatroom not found'),
      });
    }

    // 5. Generate a unique connection ID for this session
    const connectionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 6. Get this machine's stable ID (best-effort, non-critical)
    const machineId = yield* Effect.promise(() =>
      getMachineId()
        .then((id) => id ?? undefined)
        .catch(() => undefined as string | undefined)
    );

    // 7. Determine agent type from team agent config (best-effort)
    type AgentConfig = { role: string; type: 'custom' | 'remote' };
    const teamConfigs = yield* backend
      .query<AgentConfig[]>(api.machines.getTeamAgentConfigs, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(Effect.catchAll(() => Effect.succeed([] as AgentConfig[])));

    const participantAgentType = teamConfigs?.find(
      (c) => c.role.toLowerCase() === options.role.toLowerCase()
    )?.type;

    // 8. Register presence in the chatroom before starting the subscription
    yield* backend
      .mutation<void>(api.participants.join, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: options.role,
        action: 'get-next-task:connecting',
        connectionId,
        machineId,
        agentType: participantAgentType,
      })
      .pipe(Effect.mapError((cause): GetNextTaskError => ({ _tag: 'JoinFailed', cause })));

    // 9. Log initial connection with timestamp
    if (!options.silent) {
      yield* Effect.sync(() => {
        const connectionTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        console.log(`[${connectionTime}] ⏳ Connecting to chatroom as "${options.role}"...`);
      });
    }

    // 10. Fetch init prompt from backend (non-critical — swallow errors)
    type InitPromptResult = { prompt?: string; hasSystemPromptControl?: boolean } | null;
    const initPromptResult = yield* backend
      .query<InitPromptResult>(api.messages.getInitPrompt, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: options.role,
        convexUrl,
      })
      .pipe(Effect.catchAll(() => Effect.succeed(null as InitPromptResult)));

    if (initPromptResult?.prompt) {
      yield* Effect.sync(() => {
        const connectedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
        console.log(
          `[${connectedTime}] ✅ Connected. Blocking until the next user or team message resolves as a chatroom task...\n`
        );
        console.log(
          `💡 Session active (Level A). Each blocking get-next-task resolves with one chatroom task (Level B) when a message is ready; handoff completes Level B and the session continues with get-next-task.\n`
        );
        console.log(`⚠️ IMPORTANT: ${getNextTaskReminder()}\n`);

        if (!initPromptResult.hasSystemPromptControl) {
          console.log('<!-- REFERENCE: Agent Initialization');
          console.log('');
          console.log('═'.repeat(50));
          console.log('📋 AGENT INITIALIZATION PROMPT');
          console.log('═'.repeat(50));
          console.log('');
          console.log(getNextTaskGuidance());
          console.log('');
          console.log('═'.repeat(50));
          console.log('');
          console.log(initPromptResult.prompt);
          console.log('');
          console.log('═'.repeat(50));
          console.log('-->');
          console.log('');
        }
      });
    }

    // 11. Get the Convex client for the session (module-level, mockable in tests)
    const client = yield* Effect.promise(() => getConvexClient());

    // 12. Create and start the session
    const session = sessionFactory.createSession({
      chatroomId,
      role: options.role,
      silent: !!options.silent,
      sessionId,
      connectionId,
      cliEnvPrefix,
      client,
    });

    yield* Effect.tryPromise({
      try: () => session.start(),
      catch: (e): GetNextTaskError => ({
        _tag: 'SessionFailed',
        cause: e instanceof Error ? e : new Error(String(e)),
      }),
    });
  });

// ─── Error Handler ─────────────────────────────────────────────────────────

/**
 * Maps typed errors to console output + process.exit(1).
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleGetNextTaskError(err: GetNextTaskError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      // Message already printed in getNextTaskEffect — just exit
      process.exit(1);
    }
    if (err._tag === 'NotAuthorized') {
      // Message already printed in getNextTaskEffect — just exit
      process.exit(1);
    }
    if (err._tag === 'JoinFailed') {
      console.error(`\n❌ Failed to join chatroom: ${err.cause.message}`);
      process.exit(1);
    }
    if (err._tag === 'SessionFailed') {
      console.error(`\n❌ Session failed: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Get next task from a chatroom.
 *
 * Handles all pre-flight validation (auth, chatroom access, participant join,
 * init prompt) and then delegates to `GetNextTaskSession.start()`.
 */
export async function getNextTask(chatroomId: string, options: GetNextTaskOptions): Promise<void> {
  const layer = await buildDefaultLayer();

  await Effect.runPromise(
    getNextTaskEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleGetNextTaskError(err)),
      Effect.provide(layer)
    )
  );
}
