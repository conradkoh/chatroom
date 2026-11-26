import { Effect } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { listPagesEffect } from './pages.js';
import { commandServicesLayerFromDeps } from '../../infrastructure/services/index.js';

const CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
const P1 = 'msg_page_one_1234567890';
const P2 = 'msg_page_two_1234567890';

function layerReturning(window: unknown) {
  const query = vi.fn(async (_endpoint: unknown, _args: unknown) => window);
  return {
    query,
    layer: commandServicesLayerFromDeps({
      backend: {
        query,
        mutation: async () => ({}),
      },
      session: {
        getSessionId: async () => 'sess123' as never,
        getConvexUrl: () => 'http://test:3210',
        getOtherSessionUrls: async () => [],
      },
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listPagesEffect', () => {
  test('prints pages oldest first with latest and selected tags', async () => {
    const window = {
      pages: [
        {
          pageId: P1,
          startedAt: 1_000,
          endExclusive: 2_000,
          contentPreview: 'first  page\ncontent',
        },
        { pageId: P2, startedAt: 2_000, endExclusive: null, contentPreview: 'latest request' },
      ],
      selectedPageId: P2,
      prevPageId: null,
      nextPageId: null,
    };
    const { layer } = layerReturning(window);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await Effect.runPromise(
      listPagesEffect(CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(layer))
    );

    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain(`📄 Pages in chatroom ${CHATROOM_ID} (2 shown)`);
    expect(output).toContain(`  ${P1}  1970-01-01T00:00:01.000Z  first page content`);
    expect(output).toContain(
      `  ${P2}  1970-01-01T00:00:02.000Z  latest request  [latest]  [selected]`
    );
    expect(output).toContain('prev page: none   next page: none');
    expect(output).toContain(
      `💡 Download the latest page:  chatroom messages download --chatroom-id=${CHATROOM_ID} --role=builder`
    );
    expect(output).toContain(
      `💡 Download an older page:    chatroom messages download --chatroom-id=${CHATROOM_ID} --role=builder --page-id=<pageId> [--before=<n>] [--after=<n>]`
    );
  });

  test('prints the empty-chatroom line and nothing else', async () => {
    const { layer } = layerReturning({
      pages: [],
      selectedPageId: null,
      prevPageId: null,
      nextPageId: null,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await Effect.runPromise(
      listPagesEffect(CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(layer))
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe('📭 No pages: this chatroom has no user messages yet.');
  });

  test('places [selected] on the selected non-latest page and prints neighbour ids', async () => {
    const window = {
      pages: [
        { pageId: P1, startedAt: 1_000, endExclusive: 2_000, contentPreview: 'older page' },
        { pageId: P2, startedAt: 2_000, endExclusive: null, contentPreview: 'latest page' },
      ],
      selectedPageId: P1,
      prevPageId: 'msg_page_prev_1234567890',
      nextPageId: 'msg_page_next_1234567890',
    };
    const { layer } = layerReturning(window);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await Effect.runPromise(
      listPagesEffect(CHATROOM_ID, { role: 'builder', pageId: P1 }).pipe(Effect.provide(layer))
    );

    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain(`  ${P1}  1970-01-01T00:00:01.000Z  older page  [selected]`);
    expect(output).toContain(`  ${P2}  1970-01-01T00:00:02.000Z  latest page  [latest]`);
    expect(output).toContain(
      'prev page: msg_page_prev_1234567890   next page: msg_page_next_1234567890'
    );
  });

  test('passes the default page span to the backend', async () => {
    const { layer, query } = layerReturning({
      pages: [],
      selectedPageId: null,
      prevPageId: null,
      nextPageId: null,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await Effect.runPromise(
      listPagesEffect(CHATROOM_ID, { role: 'builder' }).pipe(Effect.provide(layer))
    );

    expect(query.mock.calls[0]?.[1]).toMatchObject({ before: 9, after: 0 });
  });
});
