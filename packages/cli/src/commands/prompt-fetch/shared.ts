/**
 * Shared Effect pipeline for chatroom prompt fetch commands (get-system-prompt, get-role-guidance).
 */

import { Effect, Layer } from 'effect';

import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';

export interface PromptFetchDeps {
  backend: BackendOps;
  session: SessionOps;
}

export interface PromptFetchOptions {
  role: string;
}

export type PromptFetchError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'InvalidChatroomId'; readonly chatroomId: string }
  | { readonly _tag: 'ChatroomNotFound'; readonly chatroomId: string }
  | { readonly _tag: 'BackendError'; readonly cause: Error };

export interface ChatroomTeamInfo {
  teamId: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint: string;
}

async function createPromptFetchDeps(): Promise<PromptFetchDeps> {
  // fallow-ignore-next-line code-duplication
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

function promptFetchLayerFromDeps(
  deps: PromptFetchDeps
): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(BackendServiceLive(deps.backend), SessionServiceLive(deps.session));
}

function loadChatroomTeamContextEffect(
  chatroomId: string
): Effect.Effect<
  { convexUrl: string | null; chatroom: ChatroomTeamInfo },
  PromptFetchError,
  BackendService | SessionService
> {
  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    if (!chatroomId || chatroomId.trim() === '') {
      return yield* Effect.fail<PromptFetchError>({
        _tag: 'InvalidChatroomId',
        chatroomId,
      });
    }

    const session = yield* SessionService;
    const sessionId = yield* session.getSessionId();
    if (!sessionId) {
      return yield* Effect.fail<PromptFetchError>({ _tag: 'NotAuthenticated' });
    }

    const convexUrl = yield* session.getConvexUrl();
    const backend = yield* BackendService;
    const chatroom = yield* backend
      .query<ChatroomTeamInfo | null>(api.chatrooms.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      })
      .pipe(Effect.mapError((cause): PromptFetchError => ({ _tag: 'BackendError', cause })));

    if (!chatroom) {
      return yield* Effect.fail<PromptFetchError>({
        _tag: 'ChatroomNotFound',
        chatroomId,
      });
    }

    return { convexUrl, chatroom };
  });
}

export function loadChatroomTeamContext(
  chatroomId: string
): Effect.Effect<
  { convexUrl: string | null; chatroom: ChatroomTeamInfo },
  PromptFetchError,
  BackendService | SessionService
> {
  return loadChatroomTeamContextEffect(chatroomId);
}

function handlePromptFetchError(err: PromptFetchError, resourceLabel: string): Effect.Effect<void> {
  // fallow-ignore-next-line code-duplication
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
      console.error(`❌ Error fetching ${resourceLabel}: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

export async function runPromptFetchEffect(
  effect: Effect.Effect<void, PromptFetchError, BackendService | SessionService>,
  resourceLabel: string,
  deps?: PromptFetchDeps
): Promise<void> {
  const d = deps ?? (await createPromptFetchDeps());
  const layer = promptFetchLayerFromDeps(d);

  await Effect.runPromise(
    effect.pipe(
      Effect.catchAll((err) => handlePromptFetchError(err, resourceLabel)),
      Effect.provide(layer)
    )
  );
}
