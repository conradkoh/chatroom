/**
 * Messages Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (listBySenderRoleEffect, listSinceMessageEffect)
 * using test layers. These tests verify typed error handling and business logic
 * without testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  listBySenderRoleEffect,
  listSinceMessageEffect,
  type ListBySenderRoleOptions,
  type ListSinceMessageOptions,
  type MessagesError,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

const MOCK_MESSAGE = {
  _id: 'msg_test123' as const,
  _creationTime: Date.now(),
  type: 'text' as const,
  content: 'Hello world',
  senderRole: 'user',
  targetRole: null as string | null,
  classification: null as string | null,
  taskStatus: null as string | null,
  featureTitle: null as string | null,
};

/** Create a test backend service with configurable query responses */
function makeTestBackend(config: { queryResponse?: unknown | Error }) {
  return Layer.succeed(BackendService, {
    query: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.queryResponse instanceof Error) {
        return Effect.fail(config.queryResponse) as any;
      }
      return Effect.succeed(config.queryResponse) as any;
    }),
    mutation: vi.fn(() => Effect.fail(new Error('Mutation not used in messages')) as any),
    action: vi.fn(() => Effect.fail(new Error('Action not used in messages')) as any),
  });
}

/** Create a test session service with configurable responses */
function makeTestSession(config: {
  sessionId?: string | null;
  convexUrl?: string;
  otherUrls?: string[];
}) {
  return Layer.succeed(SessionService, {
    getSessionId: () =>
      Effect.succeed(
        (config.sessionId !== undefined
          ? config.sessionId
          : 'test-session-id') as unknown as SessionId
      ),
    getConvexUrl: () => Effect.succeed(config.convexUrl ?? 'https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed(config.otherUrls ?? []),
  });
}

const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
const validSenderRoleOptions: ListBySenderRoleOptions = {
  role: 'builder',
  senderRole: 'user',
  limit: 10,
};
const validSinceMessageOptions: ListSinceMessageOptions = {
  role: 'builder',
  sinceMessageId: 'msg_abc123_test_message_1',
  limit: 100,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('listBySenderRoleEffect', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid inputs and messages returned', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: [MOCK_MESSAGE] }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listBySenderRoleEffect(validChatroomId, validSenderRoleOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalled();
  });

  test('succeeds with empty message list', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: [] }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listBySenderRoleEffect(validChatroomId, validSenderRoleOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({
        sessionId: null,
        convexUrl: 'https://test.convex.cloud',
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      listBySenderRoleEffect(validChatroomId, validSenderRoleOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
      if (error?._tag === 'NotAuthenticated') {
        expect(error.convexUrl).toBe('https://test.convex.cloud');
        expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
      }
    }
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const shortId = 'short123'; // Less than 20 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listBySenderRoleEffect(shortId, validSenderRoleOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with QueryFailed when backend query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Connection refused') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listBySenderRoleEffect(validChatroomId, validSenderRoleOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('QueryFailed');
      if (error?._tag === 'QueryFailed') {
        expect(error.cause.message).toBe('Connection refused');
      }
    }
  });
});

describe('listSinceMessageEffect', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('succeeds with valid inputs and messages returned', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: [MOCK_MESSAGE] }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSinceMessageEffect(validChatroomId, validSinceMessageOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalled();
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({
        sessionId: null,
        convexUrl: 'https://test.convex.cloud',
        otherUrls: [],
      })
    );

    const exit = await Effect.runPromiseExit(
      listSinceMessageEffect(validChatroomId, validSinceMessageOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const shortId = 'short123'; // Less than 20 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSinceMessageEffect(shortId, validSinceMessageOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with QueryFailed when backend query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Network timeout') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSinceMessageEffect(validChatroomId, validSinceMessageOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as MessagesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('QueryFailed');
      if (error?._tag === 'QueryFailed') {
        expect(error.cause.message).toBe('Network timeout');
      }
    }
  });
});
