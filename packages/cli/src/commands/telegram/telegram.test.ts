/**
 * Telegram Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (sendMessageEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import type { Exit } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  sendMessageEffect,
  type SendMessageError,
  type TelegramSendMessageOptions,
} from './index.js';
import { api } from '../../api.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable action responses */
function makeTestBackend(config: { actionResponse?: unknown | Error | undefined }) {
  const action = vi.fn((_endpoint: any, _args: unknown) => {
    if (config.actionResponse instanceof Error) {
      return Effect.fail(config.actionResponse) as any;
    }
    return Effect.succeed(config.actionResponse) as any;
  });
  const layer = Layer.succeed(BackendService, {
    query: vi.fn(),
    mutation: vi.fn(),
    action,
  });
  return { layer, action };
}

/** Create a test session service with configurable responses */
function makeTestSession(config: {
  sessionId?: string | null | undefined;
  convexUrl?: string | undefined;
  otherUrls?: string[] | undefined;
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

/** Extract the typed failure from an Effect exit. */
function failureOf(exit: Exit.Exit<unknown, SendMessageError>): SendMessageError | null {
  if (exit._tag !== 'Failure') return null;
  return Cause.findErrorOption(exit.cause).pipe((option) =>
    option._tag === 'Some' ? option.value : null
  ) as SendMessageError | null;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('sendMessageEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validIntegrationId = 'kd7abcdefghijklmnopqrstuvwxyz012'; // 32 chars - valid
  const validOptions: TelegramSendMessageOptions = {
    chatroomId: validChatroomId,
    integrationId: validIntegrationId,
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

  test('succeeds with valid inputs, passing integrationId to the action', async () => {
    const backend = makeTestBackend({
      actionResponse: {
        success: true,
        integrationId: validIntegrationId,
        telegramMessageId: 42,
      },
    });

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    expect(exit._tag).toBe('Success');
    expect(backend.action).toHaveBeenCalledTimes(1);
    expect(backend.action).toHaveBeenCalledWith(api.integrations.telegram.actions.sendMessage, {
      sessionId: 'test-session',
      chatroomId: 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2',
      integrationId: 'kd7abcdefghijklmnopqrstuvwxyz012',
      message: 'Test message',
      senderRole: 'builder',
    });
    expect(console.log).toHaveBeenCalledWith('✅ Message sent to Telegram');
    expect(console.log).toHaveBeenCalledWith(`   Integration: ${validIntegrationId}`);
    expect(console.log).toHaveBeenCalledWith('📨 "Test message"');
  });

  test('fails with InvalidIntegrationId before calling the backend', async () => {
    const backend = makeTestBackend({});

    const exit = await Effect.runPromiseExit(
      sendMessageEffect({ ...validOptions, integrationId: 'telegram-123' }).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    const error = failureOf(exit);
    expect(error?._tag).toBe('InvalidIntegrationId');
    if (error?._tag === 'InvalidIntegrationId') {
      expect(error.id).toBe('telegram-123');
    }
    expect(backend.action).not.toHaveBeenCalled();
  });

  test('fails with ActionFailed and prints no success line when the backend does not confirm', async () => {
    const backend = makeTestBackend({ actionResponse: {} });

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    const error = failureOf(exit);
    expect(error?._tag).toBe('ActionFailed');
    expect(console.log).not.toHaveBeenCalledWith('✅ Message sent to Telegram');
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const backend = makeTestBackend({});

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(
        Effect.provide(
          Layer.mergeAll(
            backend.layer,
            makeTestSession({
              sessionId: null,
              convexUrl: 'https://test.convex.cloud',
              otherUrls: ['https://prod.convex.cloud'],
            })
          )
        )
      )
    );

    const error = failureOf(exit);
    expect(error?._tag).toBe('NotAuthenticated');
    if (error?._tag === 'NotAuthenticated') {
      expect(error.convexUrl).toBe('https://test.convex.cloud');
      expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
    }
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const shortId = 'short123'; // Less than 20 chars
    const backend = makeTestBackend({});

    const exit = await Effect.runPromiseExit(
      sendMessageEffect({ ...validOptions, chatroomId: shortId }).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    const error = failureOf(exit);
    expect(error?._tag).toBe('InvalidChatroomId');
    if (error?._tag === 'InvalidChatroomId') {
      expect(error.id).toBe(shortId);
    }
  });

  test('fails with EmptyMessage when message is empty', async () => {
    const backend = makeTestBackend({});

    const exit = await Effect.runPromiseExit(
      sendMessageEffect({ ...validOptions, message: '' }).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    expect(failureOf(exit)?._tag).toBe('EmptyMessage');
  });

  test('fails with ActionFailed when backend action throws', async () => {
    const backend = makeTestBackend({ actionResponse: new Error('Network error') });

    const exit = await Effect.runPromiseExit(
      sendMessageEffect(validOptions).pipe(
        Effect.provide(
          Layer.mergeAll(backend.layer, makeTestSession({ sessionId: 'test-session' }))
        )
      )
    );

    const error = failureOf(exit);
    expect(error?._tag).toBe('ActionFailed');
    if (error?._tag === 'ActionFailed') {
      expect(error.cause.message).toBe('Network error');
    }
  });
});
