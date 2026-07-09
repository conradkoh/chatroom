/**
 * Context Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  readContextEffect,
  newContextEffect,
  listContextsEffect,
  inspectContextEffect,
  type ContextError,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable query/mutation responses */
function makeTestBackend(config: {
  queryResponse?: unknown | Error;
  mutationResponse?: unknown | Error;
}) {
  return Layer.succeed(BackendService, {
    query: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.queryResponse instanceof Error) {
        return Effect.fail(config.queryResponse) as any;
      }
      return Effect.succeed(config.queryResponse) as any;
    }),
    mutation: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.mutationResponse instanceof Error) {
        return Effect.fail(config.mutationResponse) as any;
      }
      return Effect.succeed(config.mutationResponse) as any;
    }),
    action: vi.fn(() => Effect.fail(new Error('Action not used in context')) as any),
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('readContextEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions = { role: 'planner' };

  test('succeeds with valid context data', async () => {
    const mockContext = {
      messages: [
        {
          _id: 'msg1',
          senderRole: 'user',
          type: 'user_message',
          content: 'Test message',
        },
      ],
      currentContext: {
        content: 'Test context',
        createdBy: 'planner',
        createdAt: Date.now(),
      },
      pendingTasksForRole: 0,
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockContext }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      readContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      readContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
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
      readContextEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with ReadContextFailed when query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Network error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      readContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ReadContextFailed');
      if (error?._tag === 'ReadContextFailed') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });
});

describe('newContextEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
  const validOptions = {
    role: 'planner',
    content: 'Test context content',
  };

  test('succeeds with valid input', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: 'context-id-123' }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      newContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const testLayer = Layer.mergeAll(makeTestBackend({}), makeTestSession({ sessionId: null }));

    const exit = await Effect.runPromiseExit(
      newContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  test('fails with InvalidChatroomId when ID is invalid', async () => {
    const shortId = 'short';
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      newContextEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with EmptyContent when content is empty', async () => {
    const optionsWithEmptyContent = { ...validOptions, content: '' };
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      newContextEffect(validChatroomId, optionsWithEmptyContent).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('EmptyContent');
    }
  });

  test('fails with NewContextFailed for other mutation errors', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Server error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      newContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NewContextFailed');
    }
  });
});

describe('listContextsEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
  const validOptions = { role: 'planner' };

  test('succeeds with valid context list', async () => {
    const mockContexts = [
      {
        _id: 'ctx1',
        createdBy: 'planner',
        createdAt: Date.now(),
        content: 'Context 1',
      },
      {
        _id: 'ctx2',
        createdBy: 'builder',
        createdAt: Date.now(),
        content: 'Context 2',
      },
    ];

    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockContexts }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listContextsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with ListContextsFailed when query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Query failed') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listContextsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ListContextsFailed');
    }
  });
});

describe('inspectContextEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
  const validOptions = {
    role: 'planner',
    contextId: 'ctx-123',
  };

  test('succeeds with valid context details', async () => {
    const mockContext = {
      _id: 'ctx-123',
      createdBy: 'planner',
      createdAt: Date.now(),
      content: 'Context content',
      elapsedHours: 2.5,
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockContext }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      inspectContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with InspectContextFailed when query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Context not found') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      inspectContextEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ContextError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InspectContextFailed');
    }
  });
});
