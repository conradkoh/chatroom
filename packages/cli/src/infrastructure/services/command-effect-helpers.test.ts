import { Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import {
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from './command-effect-helpers.js';
import { BackendService, SessionService } from './index.js';

describe('validateChatroomIdEffect', () => {
  test('succeeds for valid chatroom id', async () => {
    const result = await Effect.runPromise(
      validateChatroomIdEffect('jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2', (id) => ({
        _tag: 'InvalidChatroomId' as const,
        id,
      }))
    );
    expect(result).toBeUndefined();
  });

  test('fails for short chatroom id', async () => {
    const result = await Effect.runPromiseExit(
      validateChatroomIdEffect('short', (id) => ({
        _tag: 'InvalidChatroomId' as const,
        id,
      }))
    );
    expect(result._tag).toBe('Failure');
  });
});

describe('commandServicesLayerFromDeps', () => {
  test('provides backend and session services from deps', async () => {
    const layer = commandServicesLayerFromDeps({
      backend: {
        query: async () => ({ ok: true }),
        mutation: async () => ({ ok: true }),
      },
      session: {
        getSessionId: async () => 'session123' as never,
        getConvexUrl: () => 'https://example.convex.cloud',
        getOtherSessionUrls: async () => [],
      },
    });

    const program = Effect.gen(function* () {
      const backend = yield* BackendService;
      const session = yield* SessionService;
      const queryResult = yield* backend.query('test' as never, {});
      const sessionId = yield* session.getSessionId();
      return { queryResult, sessionId };
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result.queryResult).toEqual({ ok: true });
    expect(result.sessionId).toBe('session123');
  });
});

describe('requireSessionIdEffect', () => {
  test('returns session id when authenticated', async () => {
    const layer = Layer.succeed(SessionService, {
      getSessionId: () => Effect.succeed('session123' as never),
      getConvexUrl: () => Effect.succeed('https://example.convex.cloud'),
      getOtherSessionUrls: () => Effect.succeed([]),
    });

    const sessionId = await Effect.runPromise(
      requireSessionIdEffect((a) => ({
        _tag: 'NotAuthenticated' as const,
        convexUrl: a.convexUrl,
        otherUrls: a.otherUrls,
      })).pipe(Effect.provide(layer))
    );
    expect(sessionId).toBe('session123');
  });

  test('fails with auth error when not authenticated', async () => {
    const layer = Layer.succeed(SessionService, {
      getSessionId: () => Effect.succeed(null),
      getConvexUrl: () => Effect.succeed('https://example.convex.cloud'),
      getOtherSessionUrls: () => Effect.succeed(['https://other.convex.cloud']),
    });

    const result = await Effect.runPromiseExit(
      requireSessionIdEffect((a) => ({
        _tag: 'NotAuthenticated' as const,
        convexUrl: a.convexUrl,
        otherUrls: a.otherUrls,
      })).pipe(Effect.provide(layer))
    );
    expect(result._tag).toBe('Failure');
  });
});
