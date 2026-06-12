/**
 * Guidelines Effect Pipeline Tests — TDD unit tests for Effect-TS service layer.
 *
 * Tests the pure Effect programs (viewGuidelinesEffect, listGuidelineTypesEffect)
 * using test layers, before implementing the functions themselves.
 * These tests focus on the Effect pipeline behavior, not the boundary layer.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Effect, Exit, Layer, Cause } from 'effect';
import { describe, it, expect } from 'vitest';

import { viewGuidelinesEffect, listGuidelineTypesEffect, type GuidelinesError } from './index.js';
import { BackendService } from '../../infrastructure/services/backend.js';
import { SessionService } from '../../infrastructure/services/session.js';

// ─── Test Layers ───────────────────────────────────────────────────────────

const makeTestBackend = (result: unknown) =>
  Layer.succeed(BackendService, {
    query: () => Effect.succeed(result) as any,
    mutation: () => Effect.die('not called') as any,
    action: () => Effect.die('not called') as any,
  });

const makeTestBackendThatFails = (error: Error) =>
  Layer.succeed(BackendService, {
    query: () => Effect.fail(error) as any,
    mutation: () => Effect.die('not called') as any,
    action: () => Effect.die('not called') as any,
  });

const makeTestSession = (sessionId: SessionId | null) =>
  Layer.succeed(SessionService, {
    getSessionId: () => Effect.succeed(sessionId),
    getConvexUrl: () => Effect.succeed('https://test.convex.cloud'),
    getOtherSessionUrls: () => Effect.succeed([]),
  });

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('viewGuidelinesEffect', () => {
  it('fails with InvalidType when type is not valid', async () => {
    const exit = await Effect.runPromiseExit(
      viewGuidelinesEffect({ type: 'invalid-type' }).pipe(
        Effect.provide(makeTestSession('sess-1' as SessionId)),
        Effect.provide(makeTestBackend({}))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GuidelinesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidType');
      if (error?._tag === 'InvalidType') {
        expect(error.type).toBe('invalid-type');
      }
    }
  });

  it('fails with NotAuthenticated when session has no session ID', async () => {
    const exit = await Effect.runPromiseExit(
      viewGuidelinesEffect({ type: 'coding' }).pipe(
        Effect.provide(makeTestSession(null)),
        Effect.provide(makeTestBackend({}))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GuidelinesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  it('succeeds and returns guidelines when backend returns valid data', async () => {
    const mockGuidelines = {
      title: 'Coding Guidelines',
      content: 'Test guideline content',
    };

    const exit = await Effect.runPromiseExit(
      viewGuidelinesEffect({ type: 'coding' }).pipe(
        Effect.provide(makeTestSession('sess-1' as SessionId)),
        Effect.provide(makeTestBackend(mockGuidelines))
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('fails with BackendError when backend query throws', async () => {
    const testError = new Error('Backend failure');

    const exit = await Effect.runPromiseExit(
      viewGuidelinesEffect({ type: 'coding' }).pipe(
        Effect.provide(makeTestSession('sess-1' as SessionId)),
        Effect.provide(makeTestBackendThatFails(testError))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GuidelinesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('BackendError');
      if (error?._tag === 'BackendError') {
        expect(error.cause.message).toBe('Backend failure');
      }
    }
  });

  it('accepts all valid guideline types', async () => {
    const validTypes = ['coding', 'security', 'design', 'performance', 'all'];
    const mockGuidelines = { title: 'Test', content: 'Content' };

    for (const type of validTypes) {
      const exit = await Effect.runPromiseExit(
        viewGuidelinesEffect({ type }).pipe(
          Effect.provide(makeTestSession('sess-1' as SessionId)),
          Effect.provide(makeTestBackend(mockGuidelines))
        )
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }
  });
});

describe('listGuidelineTypesEffect', () => {
  it('fails with NotAuthenticated when no session', async () => {
    const exit = await Effect.runPromiseExit(
      listGuidelineTypesEffect().pipe(
        Effect.provide(makeTestSession(null)),
        Effect.provide(makeTestBackend([]))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GuidelinesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('NotAuthenticated');
    }
  });

  it('succeeds and returns guideline types when backend returns valid data', async () => {
    const mockTypes = [
      { type: 'coding', description: 'Code review guidelines' },
      { type: 'security', description: 'Security review guidelines' },
    ];

    const exit = await Effect.runPromiseExit(
      listGuidelineTypesEffect().pipe(
        Effect.provide(makeTestSession('sess-1' as SessionId)),
        Effect.provide(makeTestBackend(mockTypes))
      )
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('fails with BackendError when backend query throws', async () => {
    const testError = new Error('Backend down');

    const exit = await Effect.runPromiseExit(
      listGuidelineTypesEffect().pipe(
        Effect.provide(makeTestSession('sess-1' as SessionId)),
        Effect.provide(makeTestBackendThatFails(testError))
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as GuidelinesError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('BackendError');
      if (error?._tag === 'BackendError') {
        expect(error.cause.message).toBe('Backend down');
      }
    }
  });
});
