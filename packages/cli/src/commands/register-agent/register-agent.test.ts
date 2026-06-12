/**
 * Register Agent Effect Pipeline Tests
 *
 * Tests the pure Effect pipelines using test layers.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  registerAgentEffect,
  type RegisterAgentError,
  type RegisterAgentOptions,
} from './index.js';
import { RegisterAgentMachineService } from './machine-service.js';
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
    action: vi.fn(() => Effect.fail(new Error('Action not used in register-agent')) as any),
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

/** Create a test machine service with configurable responses */
function makeTestMachine(config: { machineId?: string | null; config?: any }) {
  return Layer.succeed(RegisterAgentMachineService, {
    getMachineId: vi.fn(() =>
      Effect.succeed(config.machineId !== undefined ? config.machineId : 'test-machine-id')
    ),
    loadMachineConfig: vi.fn(() => Effect.succeed(config.config ?? { hostname: 'test-host' })),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('registerAgentEffect', () => {
  const validChatroomId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2'; // 32 chars - valid
  const remoteOptions: RegisterAgentOptions = {
    role: 'planner',
    type: 'remote',
  };
  const customOptions: RegisterAgentOptions = {
    role: 'builder',
    type: 'custom',
  };

  test('succeeds with remote type when machine is registered', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponse: { _id: 'chatroom-123' },
        mutationResponse: undefined,
      }),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({ machineId: 'machine-123', config: { hostname: 'test-machine' } })
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Success');
  });

  test('succeeds with custom type when mutation succeeds', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponse: { _id: 'chatroom-123' },
        mutationResponse: undefined,
      }),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, customOptions).pipe(Effect.provide(testLayer))
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
      }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
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
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(shortId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomId');
      if (error?._tag === 'InvalidChatroomId') {
        expect(error.id).toBe(shortId);
      }
    }
  });

  test('fails with InvalidChatroomIdChars when ID contains invalid characters', async () => {
    const invalidId = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2-invalid'; // Contains dash
    const testLayer = Layer.mergeAll(
      makeTestBackend({}),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(invalidId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('InvalidChatroomIdChars');
    }
  });

  test('fails with ChatroomNotFound when query returns null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: null }),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('ChatroomNotFound');
      if (error?._tag === 'ChatroomNotFound') {
        expect(error.chatroomId).toBe(validChatroomId);
      }
    }
  });

  test('fails with MachineNotRegistered when remote type and machineId is null', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({ queryResponse: { _id: 'chatroom-123' } }),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({ machineId: null })
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, remoteOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('MachineNotRegistered');
    }
  });

  test('fails with RegisterFailed when custom mutation throws', async () => {
    const testLayer = Layer.mergeAll(
      makeTestBackend({
        queryResponse: { _id: 'chatroom-123' },
        mutationResponse: new Error('Registration failed'),
      }),
      makeTestSession({ sessionId: 'test-session' }),
      makeTestMachine({})
    );

    const exit = await Effect.runPromiseExit(
      registerAgentEffect(validChatroomId, customOptions).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.failureOption(exit.cause).pipe((option) =>
        option._tag === 'Some' ? option.value : null
      ) as RegisterAgentError | null;
      expect(error).not.toBeNull();
      expect(error?._tag).toBe('RegisterFailed');
      if (error?._tag === 'RegisterFailed') {
        expect(error.cause.message).toBe('Registration failed');
      }
    }
  });
});
