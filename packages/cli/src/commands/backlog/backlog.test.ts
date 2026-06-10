/**
 * Backlog Effect Pipeline Tests
 *
 * Tests pure Effect programs (listBacklogEffect, addBacklogEffect, etc.) using
 * test layers. Covers typed error handling without real network calls or process.exit.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import type { Exit } from 'effect';
import { Cause, Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { BacklogFsService } from './backlog-fs-service.js';
import {
  addBacklogEffect,
  closeBacklogEffect,
  completeBacklogEffect,
  exportBacklogEffect,
  historyBacklogEffect,
  importBacklogEffect,
  listBacklogEffect,
  markForReviewBacklogEffect,
  patchBacklogEffect,
  reopenBacklogEffect,
  scoreBacklogEffect,
  updateBacklogEffect,
  type BacklogError,
  computeContentHash,
} from './index.js';
import { BackendService, SessionService } from '../../infrastructure/services/index.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn().mockReturnValue('http://localhost:3210'),
  getConvexClient: vi.fn().mockResolvedValue({ mutation: vi.fn(), query: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type QueryResponse = Record<string, unknown> | null | unknown[];

function makeTestBackend(opts: {
  queryResponses?: (QueryResponse | Error)[];
  mutationResponse?: Record<string, unknown> | string | undefined | Error;
}) {
  let queryCallCount = 0;
  const queryResponses = opts.queryResponses ?? [];

  return Layer.succeed(BackendService, {
    query: (_endpoint: unknown, _args: unknown) => {
      const response = queryResponses[queryCallCount++];
      if (response === undefined) return Effect.succeed(null) as any;
      if (response instanceof Error) return Effect.fail(response) as any;
      return Effect.succeed(response) as any;
    },
    mutation: (_endpoint: unknown, _args: unknown) => {
      const response = opts.mutationResponse;
      if (response instanceof Error) return Effect.fail(response) as any;
      return Effect.succeed(response ?? undefined) as any;
    },
    action: () => Effect.die('action not implemented') as any,
  });
}

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

function makeTestFsService(opts: {
  readFileResponse?: string | Error;
  writeFileError?: Error;
  mkdirError?: Error;
}) {
  return Layer.succeed(BacklogFsService, {
    readFile: (_path: string, _enc: unknown) => {
      if (opts.readFileResponse instanceof Error) return Effect.fail(opts.readFileResponse);
      return Effect.succeed(opts.readFileResponse ?? '{}');
    },
    writeFile: (_path: string, _data: string) => {
      if (opts.writeFileError) return Effect.fail(opts.writeFileError);
      return Effect.succeed(undefined as void);
    },
    mkdir: (_path: string, _opts?: unknown) => {
      if (opts.mkdirError) return Effect.fail(opts.mkdirError);
      return Effect.succeed(undefined as string | undefined);
    },
  });
}

function extractError<E>(exit: Exit.Exit<unknown, E>): E | null {
  if (exit._tag !== 'Failure') return null;
  const option = Cause.failureOption(exit.cause);
  return option._tag === 'Some' ? option.value : null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CHATROOM_ID = 'jx750h696te75x67z5q6cbwkph7zvm2x';
const VALID_SESSION_ID = 'session-test-123' as unknown as SessionId;
const VALID_ITEM_ID = 'item_abc123_test_task_id_001';

const AUTHENTICATED = makeTestSessionService({ sessionId: VALID_SESSION_ID });
const UNAUTHENTICATED = makeTestSessionService({ sessionId: null });

// ---------------------------------------------------------------------------
// listBacklogEffect
// ---------------------------------------------------------------------------

describe('listBacklogEffect', () => {
  test('succeeds and returns backlog items', async () => {
    const items = [
      { _id: VALID_ITEM_ID, content: 'Do something', status: 'backlog', createdAt: Date.now() },
    ];
    const backendLayer = makeTestBackend({ queryResponses: [items] });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      listBacklogEffect(VALID_CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      listBacklogEffect(VALID_CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// addBacklogEffect
// ---------------------------------------------------------------------------

describe('addBacklogEffect', () => {
  test('succeeds and creates backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: 'new-item-id' });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      addBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', content: 'New item' }).pipe(
        Effect.provide(testLayer)
      )
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      addBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', content: 'New item' }).pipe(
        Effect.provide(testLayer)
      )
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });

  test('fails with InvalidInput when content is empty', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      addBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', content: '' }).pipe(
        Effect.provide(testLayer)
      )
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('InvalidInput');
    if (err?._tag === 'InvalidInput') {
      expect(err.message).toContain('cannot be empty');
    }
  });
});

// ---------------------------------------------------------------------------
// completeBacklogEffect
// ---------------------------------------------------------------------------

describe('completeBacklogEffect', () => {
  test('succeeds and completes backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: { success: true } });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      completeBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with BacklogItemNotFound when mutation throws', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: new Error('Item not found') });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const exit = await Effect.runPromiseExit(
      completeBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('BacklogItemNotFound');
  });
});

// ---------------------------------------------------------------------------
// reopenBacklogEffect
// ---------------------------------------------------------------------------

describe('reopenBacklogEffect', () => {
  test('succeeds and reopens backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      reopenBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with BacklogItemNotFound when mutation throws', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: new Error('Item not found') });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const exit = await Effect.runPromiseExit(
      reopenBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('BacklogItemNotFound');
  });
});

// ---------------------------------------------------------------------------
// patchBacklogEffect
// ---------------------------------------------------------------------------

describe('patchBacklogEffect', () => {
  test('succeeds and patches backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      patchBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        complexity: 'medium',
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      patchBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        complexity: 'high',
      }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// scoreBacklogEffect
// ---------------------------------------------------------------------------

describe('scoreBacklogEffect', () => {
  test('succeeds and scores backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      scoreBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        value: 'high',
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with BacklogItemNotFound when item not found', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: new Error('not found') });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const exit = await Effect.runPromiseExit(
      scoreBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        complexity: 'low',
      }).pipe(Effect.provide(testLayer))
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('BacklogItemNotFound');
  });
});

// ---------------------------------------------------------------------------
// markForReviewBacklogEffect
// ---------------------------------------------------------------------------

describe('markForReviewBacklogEffect', () => {
  test('succeeds and marks item for review', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      markForReviewBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      markForReviewBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
      }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// historyBacklogEffect
// ---------------------------------------------------------------------------

describe('historyBacklogEffect', () => {
  test('succeeds and returns history', async () => {
    const backendLayer = makeTestBackend({ queryResponses: [[]] });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      historyBacklogEffect(VALID_CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      historyBacklogEffect(VALID_CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// updateBacklogEffect
// ---------------------------------------------------------------------------

describe('updateBacklogEffect', () => {
  test('succeeds and updates content', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      updateBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        content: 'Updated content',
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      updateBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        content: 'Some content',
      }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// closeBacklogEffect
// ---------------------------------------------------------------------------

describe('closeBacklogEffect', () => {
  test('succeeds and closes backlog item', async () => {
    const backendLayer = makeTestBackend({ mutationResponse: undefined });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      closeBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        reason: 'stale item',
      }).pipe(Effect.provide(testLayer))
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      closeBacklogEffect(VALID_CHATROOM_ID, {
        role: 'builder',
        backlogItemId: VALID_ITEM_ID,
        reason: 'done',
      }).pipe(Effect.provide(testLayer))
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// exportBacklogEffect
// ---------------------------------------------------------------------------

describe('exportBacklogEffect', () => {
  test('succeeds and writes export file', async () => {
    const items = [
      {
        content: 'Task 1',
        status: 'backlog',
        createdBy: 'builder',
        createdAt: Date.now(),
      },
    ];
    const backendLayer = makeTestBackend({ queryResponses: [items] });
    const fsLayer = makeTestFsService({});
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED, fsLayer);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      exportBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', path: '/tmp/export' }).pipe(
        Effect.provide(testLayer)
      )
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with NotAuthenticated when no session', async () => {
    const backendLayer = makeTestBackend({});
    const fsLayer = makeTestFsService({});
    const testLayer = Layer.mergeAll(backendLayer, UNAUTHENTICATED, fsLayer);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      exportBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', path: '/tmp/export' }).pipe(
        Effect.provide(testLayer)
      )
    );
    consoleSpy.mockRestore();

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('NotAuthenticated');
  });
});

// ---------------------------------------------------------------------------
// importBacklogEffect
// ---------------------------------------------------------------------------

describe('importBacklogEffect', () => {
  test('succeeds and imports items', async () => {
    const exportData = {
      exportedAt: Date.now(),
      chatroomId: VALID_CHATROOM_ID,
      items: [
        {
          contentHash: computeContentHash('Task A'),
          content: 'Task A',
          status: 'backlog',
          createdBy: 'builder',
          createdAt: Date.now(),
        },
      ],
    };

    const backendLayer = makeTestBackend({
      queryResponses: [[]], // no existing items
      mutationResponse: 'new-id',
    });
    const fsLayer = makeTestFsService({ readFileResponse: JSON.stringify(exportData) });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED, fsLayer);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = await Effect.runPromiseExit(
      importBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', path: '/tmp/export' }).pipe(
        Effect.provide(testLayer)
      )
    );
    logSpy.mockRestore();

    expect(exit._tag).toBe('Success');
  });

  test('fails with ImportFailed when file cannot be read', async () => {
    const backendLayer = makeTestBackend({});
    const fsLayer = makeTestFsService({ readFileResponse: new Error('ENOENT: no such file') });
    const testLayer = Layer.mergeAll(backendLayer, AUTHENTICATED, fsLayer);

    const exit = await Effect.runPromiseExit(
      importBacklogEffect(VALID_CHATROOM_ID, { role: 'builder', path: '/tmp/missing' }).pipe(
        Effect.provide(testLayer)
      )
    );

    expect(exit._tag).toBe('Failure');
    const err = extractError<BacklogError>(exit as any);
    expect(err?._tag).toBe('ImportFailed');
    if (err?._tag === 'ImportFailed') {
      expect(err.cause.message).toContain('ENOENT');
    }
  });
});
