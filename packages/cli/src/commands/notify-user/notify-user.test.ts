/**
 * Notify-user Effect Pipeline Tests
 *
 * Tests the pure Effect pipeline (`notifyUserEffect`) with test layers.
 * Verifies the mutation is called through Convex directly (no daemon/gateway),
 * typed error mapping (including backend ConvexError codes), and that the
 * success output tells the agent the task state is unchanged.
 */

import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { notifyUserEffect, type NotifyUserError, type NotifyUserOptions } from './index.js';
import { api } from '../../api.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Build BackendService + SessionService test layers. */
function makeTestLayer(config: {
  sessionId?: string | null | undefined;
  mutationImpl?: ((endpoint: unknown, args: unknown) => Effect.Effect<unknown, Error>) | undefined;
}) {
  const mutation = vi.fn(
    config.mutationImpl ??
      ((_endpoint: unknown, _args: unknown) => Effect.succeed({ messageId: 'msg_test_1' }) as any)
  );

  const backend = Layer.succeed(BackendService, {
    mutation: (endpoint: any, args: any) => mutation(endpoint, args) as any,
    query: vi.fn(() => Effect.fail(new Error('query not used')) as any),
    action: vi.fn(() => Effect.fail(new Error('action not used')) as any),
  });

  const session = Layer.succeed(SessionService, {
    getSessionId: () =>
      Effect.succeed(
        (config.sessionId !== undefined
          ? config.sessionId
          : 'test-session-id') as unknown as SessionId
      ),
    getConvexUrl: () => Effect.succeed('https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed(['https://prod.convex.cloud']),
  });

  return { layer: Layer.mergeAll(backend, session), mutation };
}

/** Extract the typed failure from a completed exit, if any. */
function extractError(exit: any): NotifyUserError | undefined {
  if (exit._tag !== 'Failure') return undefined;
  const option = Cause.findErrorOption(exit.cause);
  return option._tag === 'Some' ? (option.value as NotifyUserError) : undefined;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('notifyUserEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: NotifyUserOptions = {
    role: 'builder',
    message: 'Working on the fix',
  };

  test('calls api.messages.notifyUser once and reports task state unchanged', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { layer, mutation } = makeTestLayer({});

    const exit = await Effect.runPromiseExit(
      notifyUserEffect(validChatroomId, validOptions).pipe(Effect.provide(layer))
    );

    expect(exit._tag).toBe('Success');
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.messages.notifyUser, {
      sessionId: 'test-session-id',
      chatroomId: validChatroomId,
      senderRole: 'builder',
      content: 'Working on the fix',
    });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('task state unchanged');

    logSpy.mockRestore();
  });

  test('fails with NotAuthenticated when session ID is null', async () => {
    const { layer, mutation } = makeTestLayer({ sessionId: null });

    const exit = await Effect.runPromiseExit(
      notifyUserEffect(validChatroomId, validOptions).pipe(Effect.provide(layer))
    );

    const error = extractError(exit);
    expect(error?._tag).toBe('NotAuthenticated');
    if (error?._tag === 'NotAuthenticated') {
      expect(error.convexUrl).toBe('https://test.convex.cloud');
      expect(error.otherUrls).toEqual(['https://prod.convex.cloud']);
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  test('fails with InvalidChatroomId when ID is malformed', async () => {
    const { layer, mutation } = makeTestLayer({});

    const exit = await Effect.runPromiseExit(
      notifyUserEffect('short123', validOptions).pipe(Effect.provide(layer))
    );

    const error = extractError(exit);
    expect(error?._tag).toBe('InvalidChatroomId');
    if (error?._tag === 'InvalidChatroomId') {
      expect(error.id).toBe('short123');
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  test('maps a ConvexError NO_ACTIVE_TASK to NotifyUserFailed with errorData.code', async () => {
    const mutationImpl = (_endpoint: unknown, _args: unknown) =>
      Effect.fail(new ConvexError({ code: 'NO_ACTIVE_TASK', message: 'no active task' })) as any;
    const { layer } = makeTestLayer({ mutationImpl });

    const exit = await Effect.runPromiseExit(
      notifyUserEffect(validChatroomId, validOptions).pipe(Effect.provide(layer))
    );

    const error = extractError(exit);
    expect(error?._tag).toBe('NotifyUserFailed');
    if (error?._tag === 'NotifyUserFailed') {
      expect(error.errorData?.code).toBe('NO_ACTIVE_TASK');
      expect(error.errorData?.message).toBe('no active task');
    }
  });

  test('maps a plain Error to NotifyUserFailed without errorData', async () => {
    const mutationImpl = (_endpoint: unknown, _args: unknown) =>
      Effect.fail(new Error('network down')) as any;
    const { layer } = makeTestLayer({ mutationImpl });

    const exit = await Effect.runPromiseExit(
      notifyUserEffect(validChatroomId, validOptions).pipe(Effect.provide(layer))
    );

    const error = extractError(exit);
    expect(error?._tag).toBe('NotifyUserFailed');
    if (error?._tag === 'NotifyUserFailed') {
      expect(error.cause.message).toBe('network down');
      expect(error.errorData).toBeUndefined();
    }
  });
});
