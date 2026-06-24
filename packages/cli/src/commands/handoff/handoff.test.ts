/**
 * Handoff Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines (handoffEffect) using test layers.
 * These tests verify typed error handling and business logic without
 * testing process.exit behavior (which belongs in boundary tests).
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { handoffEffect, type HandoffError, type HandoffOptions } from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

/** Create a test backend service with configurable query/mutation responses */
function makeTestBackend(config: {
  queryResponse?: unknown | Error;
  mutationResponse?: unknown | Error;
  queryResponses?: (unknown | Error)[];
}) {
  let queryCallCount = 0;
  return Layer.succeed(BackendService, {
    query: vi.fn((_endpoint: any, _args: unknown) => {
      if (config.queryResponses) {
        const response = config.queryResponses[queryCallCount] ?? null;
        queryCallCount++;
        if (response instanceof Error) {
          return Effect.fail(response) as any;
        }
        return Effect.succeed(response) as any;
      }
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
    action: vi.fn(() => Effect.fail(new Error('Action not used in handoff')) as any),
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

describe('handoffEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const validOptions: HandoffOptions = {
    role: 'planner',
    message: 'Handoff message',
    nextRole: 'builder',
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
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
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
      handoffEffect(shortId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
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
      handoffEffect(longId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
    }
  });

  test('fails with ArtifactsInvalid when artifact validation returns false', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: false }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithArtifacts: HandoffOptions = {
      ...validOptions,
      attachedArtifactIds: ['artifact-id-1', 'artifact-id-2'],
    };

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, optionsWithArtifacts).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ArtifactsInvalid');
    }
  });

  test('fails with ArtifactValidationFailed when artifact validation query throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Network error') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithArtifacts: HandoffOptions = {
      ...validOptions,
      attachedArtifactIds: ['artifact-id-1'],
    };

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, optionsWithArtifacts).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ArtifactValidationFailed');
      if (error?._tag === 'ArtifactValidationFailed') {
        expect(error.cause.message).toBe('Network error');
      }
    }
  });

  test('fails with WorkflowNotFound when workflow resolution fails', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: new Error('Workflow not found') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithWorkflows: HandoffOptions = {
      ...validOptions,
      attachedWorkflowKeys: ['workflow-key-1'],
    };

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, optionsWithWorkflows).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('WorkflowNotFound');
      if (error?._tag === 'WorkflowNotFound') {
        expect(error.workflowKey).toBe('workflow-key-1');
      }
    }
  });

  test('fails with HandoffFailed when handoff mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ mutationResponse: new Error('Handoff mutation failed') }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('HandoffFailed');
      if (error?._tag === 'HandoffFailed') {
        expect(error.cause.message).toBe('Handoff mutation failed');
      }
    }
  });

  test('fails with HandoffRejected when handoff returns success=false', async () => {
    const rejectionError = {
      message: 'Invalid target role',
      code: 'INVALID_TARGET_ROLE',
      suggestedTargets: ['planner', 'architect'],
    };
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        mutationResponse: {
          success: false,
          error: rejectionError,
        },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as HandoffError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('HandoffRejected');
      if (error?._tag === 'HandoffRejected') {
        expect(error.error.message).toBe('Invalid target role');
        expect(error.error.code).toBe('INVALID_TARGET_ROLE');
        expect(error.error.suggestedTargets).toEqual(['planner', 'architect']);
      }
    }
  });

  test('succeeds when handoff mutation returns success=true', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        mutationResponse: { success: true },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, validOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with artifacts when validation passes', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponse: true, // Artifact validation passes
        mutationResponse: { success: true },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithArtifacts: HandoffOptions = {
      ...validOptions,
      attachedArtifactIds: ['artifact-id-1'],
    };

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, optionsWithArtifacts).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with workflows when resolution succeeds', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponses: [
          { workflowId: 'workflow-id-123' }, // First query: workflow resolution
          null, // Second query: workflow detail (non-fatal if fails)
        ],
        mutationResponse: { success: true },
      }),
      makeTestSession({ sessionId: 'test-session' })
    );

    const optionsWithWorkflows: HandoffOptions = {
      ...validOptions,
      attachedWorkflowKeys: ['workflow-key-1'],
    };

    const exit = await Effect.runPromiseExit(
      handoffEffect(validChatroomId, optionsWithWorkflows).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });
});
