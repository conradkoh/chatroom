/**
 * Telegram Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (sendMessageEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  sendMessageEffect,
  type SendMessageError,
  type TelegramSendMessageOptions,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable action responses */
function makeTestBackend(config: { actionResponse?: unknown | Error }) {
  return Layer.succeed(BackendService, {
    query: vi.fn(),
    mutation: vi.fn(),
    action: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.actionResponse instanceof Error) {
        return Effect.fail(config.actionResponse) as any;
      }
      return Effect.succeed(config.actionResponse) as any;
    }),
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

describe('sendMessageEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: TelegramSendMessageOptions = {
    chatroomId: validChatroomId,
    integrationId: 'telegram-123',
    message: 'Test message',
    role: 'builder',
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
    const mockResult = { success: true };

    const testLayer = Layer.mergeAll(
      makeTestBackend({ actionResponse: mockResult }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalledWith('✅ Message sent to Telegram');
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
      sendMessageEffect(validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as SendMessageError | null;
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
      sendMessageEffect({ ...validOptions, chatroomId: shortId }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as SendMessageError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with EmptyMessage when message is empty', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      sendMessageEffect({ ...validOptions, message: '' }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as SendMessageError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('EmptyMessage');
    }
  });

  test('fails with ActionFailed when backend action throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ actionResponse: new Error('Network error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as SendMessageError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ActionFailed');
      if (error?._tag === 'ActionFailed') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });
});
