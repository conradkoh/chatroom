/**
 * Get System Prompt Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (getSystemPromptEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import {
  getSystemPromptEffect,
  type GetSystemPromptError,
  type GetSystemPromptOptions,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// Import the Effect function we'll implement

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service that returns responses in sequence */
function makeTestBackend(queryResponses: (unknown | Error)[]) {
  let callCount = 0;
  return Layer.succeed(BackendService, {
    query: (_endpoint: any, _args: unknown) => {
      const response = queryResponses[callCount++];
      if (response instanceof Error) {
        return Effect.fail(response) as any;
      }
      return Effect.succeed(response) as any;
    },
    mutation: () => Effect.die('mutation not implemented in test backend') as any,
    action: () => Effect.die('action not implemented in test backend') as any,
  });
}

/** Create a test session service with configurable session ID */
function makeTestSession(sessionId: SessionId | null) {
  return Layer.succeed(SessionService, {
    getSessionId: () => Effect.succeed(sessionId),
    getConvexUrl: () => Effect.succeed('https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed([]),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('getSystemPromptEffect', () => {
  test('fails with NotAuthenticated when no session', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend([]), // Backend won't be called
      makeTestSession(null)
    );

    const options: GetSystemPromptOptions = { role: 'builder' };

    const exit = await Effect.runPromiseExit(
      getSystemPromptEffect('test-chatroom-id', options).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GetSystemPromptError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  test('fails with InvalidChatroomId when chatroomId is empty', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend([]), // Backend won't be called
      makeTestSession('sess-123' as SessionId)
    );

    const options: GetSystemPromptOptions = { role: 'builder' };

    const exit = await Effect.runPromiseExit(
      getSystemPromptEffect('', options).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GetSystemPromptError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.chatroomId).toBe('');
      }
    }
  });

  test('queries backend and succeeds with system prompt on success', async () => {
    const mockChatroom = {
      teamId: 'team-123',
      teamName: 'Test Team',
      teamRoles: ['builder', 'planner'],
      teamEntryPoint: 'planner',
    };

    const mockPrompt = 'You are a helpful builder agent...';

    // The function makes two queries: first for the chatroom, then for the prompt
    const testLayer = Layer.mergeAll(
      makeTestBackend([mockChatroom, mockPrompt]),
      makeTestSession('sess-123' as SessionId)
    );

    const options: GetSystemPromptOptions = { role: 'builder' };

    const exit = await Effect.runPromiseExit(
      getSystemPromptEffect('test-chatroom-id', options).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('fails with BackendError when backend query throws', async () => {
    // Backend fails on the first query (getting chatroom)
    const testLayer = Layer.mergeAll(
      makeTestBackend([new Error('Network error')]),
      makeTestSession('sess-123' as SessionId)
    );

    const options: GetSystemPromptOptions = { role: 'builder' };

    const exit = await Effect.runPromiseExit(
      getSystemPromptEffect('test-chatroom-id', options).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GetSystemPromptError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('BackendError');
      if (error?._tag === 'BackendError') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });

  test('fails with ChatroomNotFound when chatroom query returns null', async () => {
    // Backend returns null for the chatroom query
    const testLayer = Layer.mergeAll(
      makeTestBackend([null]),
      makeTestSession('sess-123' as SessionId)
    );

    const options: GetSystemPromptOptions = { role: 'builder' };

    const exit = await Effect.runPromiseExit(
      getSystemPromptEffect('nonexistent-id', options).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GetSystemPromptError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ChatroomNotFound');
      if (error?._tag === 'ChatroomNotFound') {
        expect(error.chatroomId).toBe('nonexistent-id');
      }
    }
  });
});
