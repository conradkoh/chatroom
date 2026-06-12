/**
 * get-next-task Effect Pipeline Tests
 *
 * Tests the pure Effect pipeline (getNextTaskEffect) using test layers.
 * Covers typed error handling and business logic without real network calls
 * or process.exit.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import type { Exit } from 'effect';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { GetNextTaskSessionService } from './get-next-task-session-service.js';
import { getNextTaskEffect, type GetNextTaskError } from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn().mockResolvedValue({ mutation: vi.fn(), query: vi.fn() }),
}));

vi.mock('../../infrastructure/machine/index.js', () => ({
  getMachineId: vi.fn().mockResolvedValue('machine-abc123'),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type QueryResponse = Record<string, unknown> | null | unknown[];

/** Create a test BackendService with configurable per-call responses. */
function makeTestBackend(opts: {
  queryResponses?: (QueryResponse | Error)[];
  mutationResponse?: Record<string, unknown> | undefined | Error;
}) {
  let queryCallCount = 0;
  const queryResponses = opts.queryResponses ?? [];

  return Layer.succeed(BackendService, {
    query: (_endpoint: unknown, _args: unknown) => {
      const response = queryResponses[queryCallCount++];
      if (response === undefined) {
        return Effect.succeed(null) as any;
      }
      if (response instanceof Error) {
        return Effect.fail(response) as any;
      }
      return Effect.succeed(response) as any;
    },
    mutation: (_endpoint: unknown, _args: unknown) => {
      const response = opts.mutationResponse;
      if (response instanceof Error) {
        return Effect.fail(response) as any;
      }
      return Effect.succeed(response ?? undefined) as any;
    },
    action: () => Effect.die('action not implemented in test backend') as any,
  });
}

/** Create a test SessionService with configurable auth state. */
function makeTestSessionService(opts: {
  sessionId?: SessionId | null;
  convexUrl?: string;
  otherUrls?: string[];
}) {
  return Layer.succeed(SessionService, {
    getSessionId: () => Effect.succeed(opts.sessionId ?? null),
    getConvexUrl: () => Effect.succeed(opts.convexUrl ?? 'http://localhost:3210'),
    getOtherSessionUrls: () => Effect.succeed(opts.otherUrls ?? []),
  });
}

/** Create a test GetNextTaskSessionService with a controllable start() mock. */
function makeTestSessionFactory(opts: { startFn?: () => Promise<void> } = {}) {
  const mockStart = vi.fn().mockImplementation(opts.startFn ?? (() => Promise.resolve(undefined)));
  const mockCreateSession = vi.fn().mockReturnValue({ start: mockStart });
  const layer = Layer.succeed(GetNextTaskSessionService, {
    createSession: mockCreateSession as any,
  });
  return { layer, mockStart, mockCreateSession };
}

/** Extract a typed failure value from an Effect Exit. */
function extractError<E>(exit: Exit.Exit<unknown, E>): E | null {
  if (exit._tag !== 'Failure') return null;
  const option = Cause.failureOption(exit.cause);
  return option._tag === 'Some' ? option.value : null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CHATROOM_ID = 'jx750h696te75x67z5q6cbwkph7zvm2x'; // 32 chars, valid
const VALID_CHATROOM = { _id: VALID_CHATROOM_ID, teamName: 'Test Team' };
const VALID_SESSION_ID = 'session-test-123' as unknown as SessionId;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getNextTaskEffect', () => {
  test('fails with NotAuthenticated when no session ID', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: null });
    const backendLayer = makeTestBackend({});
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });

  test('logs other session URLs when not authenticated', async () => {
    const otherUrls = ['https://other-project.convex.cloud'];
    const sessionLayer = makeTestSessionService({ sessionId: null, otherUrls });
    const backendLayer = makeTestBackend({});
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    const output = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    errorSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
    expect(output).toContain(otherUrls[0]);
  });

  test('fails with NotAuthorized when chatroom ID is too short (< 20 chars)', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({});
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect('shortid', { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthorized');
    if (err?._tag === 'NotAuthorized') {
      expect(err.cause.message).toContain('Invalid chatroom ID format');
    }
  });

  test('fails with NotAuthorized when chatroom ID contains invalid characters', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({});
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 27 chars (>20) but contains '!' which is invalid
    const exit = await Effect.runPromiseExit(
      getNextTaskEffect('jx750h696te75x67z5q6cbwk!!!', { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthorized');
    if (err?._tag === 'NotAuthorized') {
      expect(err.cause.message).toContain('Invalid chatroom ID characters');
    }
  });

  test('fails with NotAuthorized when chatroom is not found (null response)', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({
      queryResponses: [null], // chatrooms.get returns null
    });
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthorized');
    if (err?._tag === 'NotAuthorized') {
      expect(err.cause.message).toContain('Chatroom not found');
    }
  });

  test('fails with NotAuthorized when chatroom query throws', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({
      queryResponses: [new Error('Access denied')], // chatrooms.get throws
    });
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('NotAuthorized');
    if (err?._tag === 'NotAuthorized') {
      expect(err.cause.message).toBe('Access denied');
    }
  });

  test('fails with JoinFailed when participants.join mutation throws', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({
      queryResponses: [VALID_CHATROOM, []], // chatrooms.get, machines.getTeamAgentConfigs
      mutationResponse: new Error('Join rejected'),
    });
    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    consoleSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('JoinFailed');
    if (err?._tag === 'JoinFailed') {
      expect(err.cause.message).toBe('Join rejected');
    }
  });

  test('fails with SessionFailed when session.start() throws', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({
      // chatrooms.get, getTeamAgentConfigs, getInitPrompt
      queryResponses: [VALID_CHATROOM, [], null],
      mutationResponse: undefined,
    });
    const { layer: factoryLayer } = makeTestSessionFactory({
      startFn: () => Promise.reject(new Error('WebSocket disconnected')),
    });
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    logSpy.mockRestore();
    expect(exit._tag).toBe('Failure');
    const err = extractError<GetNextTaskError>(exit as any);
    expect(err?._tag).toBe('SessionFailed');
    if (err?._tag === 'SessionFailed') {
      expect(err.cause.message).toBe('WebSocket disconnected');
    }
  });

  test('succeeds when all pre-flight passes and session.start() resolves', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });
    const backendLayer = makeTestBackend({
      queryResponses: [VALID_CHATROOM, [], null],
      mutationResponse: undefined,
    });
    const { layer: factoryLayer, mockStart } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    logSpy.mockRestore();
    expect(exit._tag).toBe('Success');
    expect(mockStart).toHaveBeenCalledOnce();
  });

  test('passes agentType from team config to participants.join', async () => {
    const sessionLayer = makeTestSessionService({ sessionId: VALID_SESSION_ID });

    const joinArgsSpy = vi.fn();
    let queryCallCount = 0;

    const backendLayer = Layer.succeed(BackendService, {
      query: (_endpoint: unknown, _args: unknown) => {
        queryCallCount++;
        if (queryCallCount === 1) return Effect.succeed(VALID_CHATROOM) as any;
        if (queryCallCount === 2)
          return Effect.succeed([{ role: 'builder', type: 'remote' }]) as any;
        return Effect.succeed(null) as any; // getInitPrompt
      },
      mutation: (_endpoint: unknown, args: unknown) => {
        joinArgsSpy(args);
        return Effect.succeed(undefined) as any;
      },
      action: () => Effect.die('action not supported') as any,
    });

    const { layer: factoryLayer } = makeTestSessionFactory();
    const testLayer = Layer.mergeAll(backendLayer, sessionLayer, factoryLayer);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const exit = await Effect.runPromiseExit(
      getNextTaskEffect(VALID_CHATROOM_ID, { role: 'builder', silent: true }).pipe(
        Effect.provide(testLayer)
      )
    );

    logSpy.mockRestore();
    expect(exit._tag).toBe('Success');
    expect(joinArgsSpy).toHaveBeenCalledOnce();
    const joinArgs = joinArgsSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(joinArgs.agentType).toBe('remote');
  });
});
