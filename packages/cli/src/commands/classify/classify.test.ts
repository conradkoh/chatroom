/**
 * Classify Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (classifyEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { classifyEffect, type ClassifyError, type ClassifyOptions } from './index.js';
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
    action: vi.fn(() => Effect.fail(new Error('Action not used in classify')) as any),
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

describe('classifyEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: ClassifyOptions = {
    role: 'planner',
    originMessageClassification: 'question',
    taskId: 'md75t2t0c3t3mrfy7gta1s9hg588c0rh',
  };

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
      classifyEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
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
      classifyEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
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
      classifyEffect(longId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with ChatroomNotFound when chatroom query returns null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: null }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ChatroomNotFound');
      if (error?._tag === 'ChatroomNotFound') {
        expect(error.chatroomId).toBe(validChatroomId);
      }
    }
  });

  test('fails with NotEntryPointRole when role does not match entry point', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: chatroom }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithWrongRole = { ...validOptions, role: 'builder' };

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, optionsWithWrongRole).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotEntryPointRole');
      if (error?._tag === 'NotEntryPointRole') {
        expect(error.role).toBe('builder');
        expect(error.entryPoint).toBe('planner');
      }
    }
  });

  test('fails with MissingStdin when new_feature classification has no stdin', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };
    const task = { _id: validOptions.taskId, content: 'Test task' };

    // Mock backend to return chatroom on first query, task on second query
    let callCount = 0;
    const testBackend = Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Effect.succeed(chatroom) as any;
        }
        return Effect.succeed(task) as any;
      }),
      mutation: vi.fn(() => Effect.succeed({}) as any),
      action: vi.fn(() => Effect.fail(new Error('Action not used')) as any),
    });

    const testLayer = Layer.mergeAll(testBackend, makeTestSession({ sessionId: 'test-session' }));

    const optionsWithNewFeature: ClassifyOptions = {
      ...validOptions,
      originMessageClassification: 'new_feature',
      rawStdin: undefined,
    };

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, optionsWithNewFeature).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('MissingStdin');
    }
  });

  test('fails with TaskNotFound when task query returns null', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };

    // Mock backend to return chatroom on first query, null on second query (task not found)
    let callCount = 0;
    const testBackend = Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Effect.succeed(chatroom) as any;
        }
        return Effect.succeed(null) as any;
      }),
      mutation: vi.fn(() => Effect.succeed({}) as any),
      action: vi.fn(() => Effect.fail(new Error('Action not used')) as any),
    });

    const testLayer = Layer.mergeAll(testBackend, makeTestSession({ sessionId: 'test-session' }));

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('TaskNotFound');
      if (error?._tag === 'TaskNotFound') {
        expect(error.taskId).toBe(validOptions.taskId);
      }
    }
  });

  test('fails with ClassifyFailed when mutation throws', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };
    const task = { _id: validOptions.taskId, content: 'Test task' };

    // Mock backend to return chatroom on first query, task on second query, fail on mutation
    let callCount = 0;
    const testBackend = Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Effect.succeed(chatroom) as any;
        }
        return Effect.succeed(task) as any;
      }),
      mutation: vi.fn(() => Effect.fail(new Error('Backend mutation failed')) as any),
      action: vi.fn(() => Effect.fail(new Error('Action not used')) as any),
    });

    const testLayer = Layer.mergeAll(testBackend, makeTestSession({ sessionId: 'test-session' }));

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ClassifyError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ClassifyFailed');
      if (error?._tag === 'ClassifyFailed') {
        expect(error.cause.message).toBe('Backend mutation failed');
      }
    }
  });

  test('succeeds when all validations pass and mutation succeeds', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };
    const task = { _id: validOptions.taskId, content: 'Test task' };
    const mutationResult = { reminder: 'Task classified successfully' };

    // Mock backend to return chatroom on first query, task on second query, success on mutation
    let callCount = 0;
    const testBackend = Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Effect.succeed(chatroom) as any;
        }
        return Effect.succeed(task) as any;
      }),
      mutation: vi.fn(() => Effect.succeed(mutationResult) as any),
      action: vi.fn(() => Effect.fail(new Error('Action not used')) as any),
    });

    const testLayer = Layer.mergeAll(testBackend, makeTestSession({ sessionId: 'test-session' }));

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with new_feature classification when stdin is provided', async () => {
    const chatroom = {
      teamEntryPoint: 'planner',
      teamRoles: ['planner', 'builder'],
    };
    const task = { _id: validOptions.taskId, content: 'Test task' };
    const mutationResult = { reminder: 'Feature task classified' };

    let callCount = 0;
    const testBackend = Layer.succeed(BackendService, {
      query: vi.fn((_endpoint: any, _args: unknown) => {
        callCount++;
        if (callCount === 1) {
          return Effect.succeed(chatroom) as any;
        }
        return Effect.succeed(task) as any;
      }),
      mutation: vi.fn(() => Effect.succeed(mutationResult) as any),
      action: vi.fn(() => Effect.fail(new Error('Action not used')) as any),
    });

    const testLayer = Layer.mergeAll(testBackend, makeTestSession({ sessionId: 'test-session' }));

    const optionsWithStdin: ClassifyOptions = {
      ...validOptions,
      originMessageClassification: 'new_feature',
      rawStdin: '---TITLE---\nNew Feature\n---DESCRIPTION---\nDescription\n---TECH_SPECS---\nSpecs',
    };

    const exit = await Effect.runPromiseExit(
      classifyEffect(validChatroomId, optionsWithStdin).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });
});
