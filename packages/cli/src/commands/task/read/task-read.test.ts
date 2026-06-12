/**
 * Task Read Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (taskReadEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { taskReadEffect, type TaskReadError, type TaskReadOptions } from './index.js';
import { BackendService, SessionService } from '../../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable mutation responses */
function makeTestBackend(config: { mutationResponse?: unknown | Error }) {
  return Layer.succeed(BackendService, {
    query: vi.fn(),
    mutation: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.mutationResponse instanceof Error) {
        return Effect.fail(config.mutationResponse) as any;
      }
      return Effect.succeed(config.mutationResponse) as any;
    }),
    action: vi.fn(() => Effect.fail(new Error('Action not used in task read')) as any),
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

describe('taskReadEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validTaskId = 'md75t2t0c3t3mrfy7gta1s9hg588c0rh'; // 32 chars - valid
  const validOptions: TaskReadOptions = {
    role: 'builder',
    taskId: validTaskId,
  };

  // Mock console.log to avoid test output pollution
  const originalLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });
  afterEach(() => {
    console.log = originalLog;
  });

  test('succeeds with valid inputs', async () => {
    const mockResult = {
      taskId: validTaskId,
      status: 'in_progress',
      content: 'Test task content',
      context: null,
      attachedBacklogItems: null,
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: mockResult }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      taskReadEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
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
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      taskReadEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as TaskReadError | null;
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
      taskReadEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as TaskReadError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with InvalidTaskId when task ID is too short', async () => {
    const shortTaskId = 'short'; // Less than 20 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      taskReadEffect(validChatroomId, { ...validOptions, taskId: shortTaskId }).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as TaskReadError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidTaskId');
      if (error?._tag === 'InvalidTaskId') {
        expect(error.id).toBe(shortTaskId);
      }
    }
  });

  test('fails with MutationFailed when backend mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Task not found') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      taskReadEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as TaskReadError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('MutationFailed');
      if (error?._tag === 'MutationFailed') {
        expect(error.cause.message).toBe('Task not found');
      }
    }
  });
});
