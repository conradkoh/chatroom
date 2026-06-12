/**
 * Skill Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (listSkillsEffect, activateSkillEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  listSkillsEffect,
  activateSkillEffect,
  type ListSkillsError,
  type ActivateSkillError,
  type ListSkillsOptions,
  type ActivateSkillOptions,
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
    action: vi.fn(() => Effect.fail(new Error('Action not used in skill')) as any),
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

describe('listSkillsEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: ListSkillsOptions = {
    role: 'planner',
  };

  // Mock console.log to avoid test output pollution
  const originalLog = console.log;
  beforeEach(() => {
    console.log = vi.fn();
  });
  afterEach(() => {
    console.log = originalLog;
  });

  test('succeeds with valid inputs and skills', async () => {
    const mockSkills = [
      { skillId: 'backlog', name: 'Backlog', description: 'Manage backlog items', type: 'system' },
      { skillId: 'workflow', name: 'Workflow', description: 'Create workflows', type: 'system' },
    ];

    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: mockSkills }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSkillsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalled();
  });

  test('succeeds with empty skills array', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: [] }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSkillsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
    expect(console.log).toHaveBeenCalledWith('No skills available.');
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
      listSkillsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ListSkillsError | null;
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
      listSkillsEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ListSkillsError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with QueryFailed when backend query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Network error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      listSkillsEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ListSkillsError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('QueryFailed');
      if (error?._tag === 'QueryFailed') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });
});

describe('activateSkillEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validSkillId = 'backlog';
  const validOptions: ActivateSkillOptions = {
    role: 'planner',
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
      skill: {
        skillId: 'backlog',
        prompt: 'Manage backlog items using the backlog command',
      },
    };

    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: mockResult }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      activateSkillEffect(validChatroomId, validSkillId, validOptions).pipe(
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
        otherUrls: ['https://prod.convex.cloud'],
      })
    );

    const exit = await Effect.runPromiseExit(
      activateSkillEffect(validChatroomId, validSkillId, validOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ActivateSkillError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  test('fails with InvalidChatroomId when ID is too short', async () => {
    const shortId = 'short'; // Less than 20 chars
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      activateSkillEffect(shortId, validSkillId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ActivateSkillError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with MutationFailed when backend mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Skill not found') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      activateSkillEffect(validChatroomId, validSkillId, validOptions).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as ActivateSkillError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('MutationFailed');
      if (error?._tag === 'MutationFailed') {
        expect(error.cause.message).toBe('Skill not found');
      }
    }
  });
});
