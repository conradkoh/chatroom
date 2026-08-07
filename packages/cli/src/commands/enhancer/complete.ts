import { ConvexError } from 'convex/values';
import { Effect } from 'effect';

import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';

export interface EnhancerCompleteOptions {
  enhancedContent: string;
  jobId: string;
}

export type EnhancerCompleteError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | {
      readonly _tag: 'CompleteFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string; message?: string };
    };

async function createDefaultDeps() {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint: unknown, args: unknown) =>
        client.mutation(endpoint as never, args as never),
      query: (endpoint: unknown, args: unknown) => client.query(endpoint as never, args as never),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
  };
}

const enhancerCompleteEffect = (
  chatroomId: string,
  options: EnhancerCompleteOptions
): Effect.Effect<void, EnhancerCompleteError, BackendService | SessionService> =>
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

    yield* backend
      .mutation(api.web.enhancer.index.complete, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        jobId: options.jobId as Id<'chatroom_enhancerJobs'>,
        enhancedContent: options.enhancedContent,
      })
      .pipe(
        Effect.mapError((cause): EnhancerCompleteError => {
          let errorData: { code?: string; message?: string } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string; message?: string };
          }
          return { _tag: 'CompleteFailed', cause, errorData };
        })
      );

    yield* Effect.sync(() => {
      console.log(`✅ Enhancer job ${options.jobId} completed`);
    });
  });

function handleCompleteError(err: EnhancerCompleteError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    }
    if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
      process.exit(1);
    }
    console.error('\n❌ ERROR: Enhancer complete failed');
    console.error(`\n${err.errorData?.message ?? err.cause.message}`);
    process.exit(1);
  });
}

export async function enhancerComplete(
  chatroomId: string,
  options: EnhancerCompleteOptions
): Promise<void> {
  const deps = await createDefaultDeps();
  await Effect.runPromise(
    enhancerCompleteEffect(chatroomId, options).pipe(
      Effect.provide(commandServicesLayerFromDeps(deps)),
      Effect.catchAll(handleCompleteError)
    )
  );
}
