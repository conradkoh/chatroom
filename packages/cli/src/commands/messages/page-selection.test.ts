import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { Cause, Effect } from 'effect';
import type { Exit } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  formatPageSelectionError,
  parsePageSelection,
  resolvePageRange,
} from './page-selection.js';
import { api } from '../../api.js';
import type { BackendServiceShape } from '../../infrastructure/services/index.js';

const CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
const PAGE_ID = 'msg_page_start_1234567890';

/** Extracts a typed error from a Failure exit. */
function extractError<E>(exit: Exit.Exit<unknown, E>): E | null {
  if (exit._tag !== 'Failure') return null;
  const option = Cause.findErrorOption(exit.cause);
  return option._tag === 'Some' ? option.value : null;
}

function backendReturning(window: unknown) {
  const query = vi.fn((_endpoint: unknown, _args: unknown) => Effect.succeed(window));
  const backend = {
    query,
    mutation: () => Effect.succeed(undefined),
    action: () => Effect.succeed(undefined),
  } as unknown as BackendServiceShape;
  return { backend, query };
}

function backendFailing(error: Error) {
  const query = vi.fn((_endpoint: unknown, _args: unknown) => Effect.fail(error));
  const backend = {
    query,
    mutation: () => Effect.succeed(undefined),
    action: () => Effect.succeed(undefined),
  } as unknown as BackendServiceShape;
  return { backend, query };
}

const WINDOW = {
  pages: [
    {
      pageId: PAGE_ID,
      startedAt: 1_000,
      endExclusive: null,
      contentPreview: 'do it',
    },
  ],
  selectedPageId: PAGE_ID,
  prevPageId: null,
  nextPageId: null,
};

describe('parsePageSelection', () => {
  test('uses the defaults when no flags are present', async () => {
    const selection = await Effect.runPromise(parsePageSelection({}, { before: 9, after: 0 }));
    expect(selection).toEqual({ pageId: undefined, before: 9, after: 0 });
  });

  test('parses a before value', async () => {
    const selection = await Effect.runPromise(
      parsePageSelection({ before: '3' }, { before: 9, after: 0 })
    );
    expect(selection.before).toBe(3);
  });

  test('accepts the maximum span of 50', async () => {
    const selection = await Effect.runPromise(
      parsePageSelection({ before: '50' }, { before: 9, after: 0 })
    );
    expect(selection.before).toBe(50);
  });

  test('rejects a before value over the maximum', async () => {
    const exit = await Effect.runPromiseExit(
      parsePageSelection({ before: '51' }, { before: 9, after: 0 })
    );
    expect(extractError(exit)).toEqual({
      _tag: 'InvalidPageSelection',
      flag: '--before',
      value: '51',
    });
  });

  test.each(['-1', '1.5', 'abc'])('rejects after=%s', async (raw) => {
    const exit = await Effect.runPromiseExit(
      parsePageSelection({ after: raw }, { before: 9, after: 0 })
    );
    expect(extractError(exit)).toEqual({
      _tag: 'InvalidPageSelection',
      flag: '--after',
      value: raw,
    });
  });
});

describe('resolvePageRange', () => {
  test('returns the window when the requested page resolves to itself', async () => {
    const { backend, query } = backendReturning(WINDOW);

    const window = await Effect.runPromise(
      resolvePageRange(backend, {
        sessionId: 'sess123',
        chatroomId: CHATROOM_ID,
        pageId: PAGE_ID,
        before: 2,
        after: 3,
      })
    );

    expect(window).toEqual(WINDOW);
    expect(getFunctionName(query.mock.calls[0]?.[0] as never)).toBe(
      getFunctionName(api.conversation.listPages)
    );
    expect(query.mock.calls[0]?.[1]).toMatchObject({
      sessionId: 'sess123',
      chatroomId: CHATROOM_ID,
      pageId: PAGE_ID,
      before: 2,
      after: 3,
    });
  });

  test('returns PageNotFound when the server falls back to a different page', async () => {
    const { backend } = backendReturning({ ...WINDOW, selectedPageId: 'msg_other_1234567890' });

    const exit = await Effect.runPromiseExit(
      resolvePageRange(backend, {
        sessionId: 'sess123',
        chatroomId: CHATROOM_ID,
        pageId: PAGE_ID,
        before: 0,
        after: 0,
      })
    );

    expect(extractError(exit)).toEqual({ _tag: 'PageNotFound', pageId: PAGE_ID });
  });

  test('maps INVALID_PAGE to InvalidPage', async () => {
    const { backend } = backendFailing(
      new ConvexError({ code: 'INVALID_PAGE', message: 'Page must start at a user message' })
    );

    const exit = await Effect.runPromiseExit(
      resolvePageRange(backend, {
        sessionId: 'sess123',
        chatroomId: CHATROOM_ID,
        pageId: PAGE_ID,
        before: 0,
        after: 0,
      })
    );

    expect(extractError(exit)).toEqual({ _tag: 'InvalidPage', pageId: PAGE_ID });
  });

  test('maps INVALID_MESSAGE to PageNotFound', async () => {
    const { backend } = backendFailing(
      new ConvexError({
        code: 'INVALID_MESSAGE',
        message: 'Message does not belong to this chatroom',
      })
    );

    const exit = await Effect.runPromiseExit(
      resolvePageRange(backend, {
        sessionId: 'sess123',
        chatroomId: CHATROOM_ID,
        pageId: PAGE_ID,
        before: 0,
        after: 0,
      })
    );

    expect(extractError(exit)).toEqual({ _tag: 'PageNotFound', pageId: PAGE_ID });
  });

  test('maps any other failure to QueryFailed', async () => {
    const cause = new Error('network down');
    const { backend } = backendFailing(cause);

    const exit = await Effect.runPromiseExit(
      resolvePageRange(backend, {
        sessionId: 'sess123',
        chatroomId: CHATROOM_ID,
        pageId: PAGE_ID,
        before: 0,
        after: 0,
      })
    );

    expect(extractError(exit)).toEqual({ _tag: 'QueryFailed', cause });
  });
});

describe('formatPageSelectionError', () => {
  test('PageNotFound names the pages command', () => {
    expect(
      formatPageSelectionError({ _tag: 'PageNotFound', pageId: PAGE_ID }, CHATROOM_ID, 'builder')
    ).toBe(
      `❌ Page not found: ${PAGE_ID}. It was deleted or is not in this chatroom.\n   List current pages: chatroom messages pages --chatroom-id=${CHATROOM_ID} --role=builder`
    );
  });

  test('InvalidPage names the pages command', () => {
    expect(
      formatPageSelectionError({ _tag: 'InvalidPage', pageId: PAGE_ID }, CHATROOM_ID, 'builder')
    ).toBe(
      `❌ ${PAGE_ID} is not a page start. A page starts at a user message.\n   List pages: chatroom messages pages --chatroom-id=${CHATROOM_ID} --role=builder`
    );
  });

  test('InvalidPageSelection reports the flag and raw value', () => {
    expect(
      formatPageSelectionError(
        { _tag: 'InvalidPageSelection', flag: '--after', value: 'abc' },
        CHATROOM_ID,
        'builder'
      )
    ).toBe('❌ --after must be an integer from 0 to 50 (got "abc")');
  });

  test('QueryFailed reports the cause message', () => {
    expect(
      formatPageSelectionError(
        { _tag: 'QueryFailed', cause: new Error('boom') },
        CHATROOM_ID,
        'builder'
      )
    ).toBe('❌ Error fetching pages: boom');
  });
});
