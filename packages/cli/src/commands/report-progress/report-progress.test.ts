/**
 * Report Progress Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines using test layers.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  reportProgressEffect,
  type ReportProgressError,
  type ReportProgressOptions,
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
    action: vi.fn(() => Effect.fail(new Error('Action not used in report-progress')) as any),
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

describe('reportProgressEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: ReportProgressOptions = {
    role: 'planner',
    message: 'Making good progress on task',
  };

  test('succeeds with valid input', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: { success: true } }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      reportProgressEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
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
      reportProgressEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ReportProgressError | null;
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
      reportProgressEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ReportProgressError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with InvalidChatroomId when ID is too long', async () => {
    const longId = 'a'.repeat(50); // More than 40 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      reportProgressEffect(longId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ReportProgressError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with EmptyMessage when message is empty', async () => {
    const optionsWithEmptyMessage = { ...validOptions, message: '' };
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      reportProgressEffect(validChatroomId, optionsWithEmptyMessage).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ReportProgressError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('EmptyMessage');
    }
  });

  test('fails with ReportProgressFailed when mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Network error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      reportProgressEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ReportProgressError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ReportProgressFailed');
      if (error?._tag === 'ReportProgressFailed') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });
});
