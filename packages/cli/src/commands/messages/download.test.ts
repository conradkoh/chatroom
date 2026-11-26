import type { Message } from '@workspace/backend/src/domain/entities/message';
import { getFunctionName } from 'convex/server';
import { Cause, Effect, Layer } from 'effect';
import type { Exit } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { downloadMessagesEffect, resolveDownloadOutputDir } from './download.js';
import { MessagesFsService } from './messages-fs-service.js';
import { api } from '../../api.js';
import { commandServicesLayerFromDeps } from '../../infrastructure/services/index.js';

const CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
const P1 = 'msg_page_one_1234567890';
const P2 = 'msg_page_two_1234567890';
const P_MID = 'msg_page_mid_1234567890';
const P_NEXT = 'msg_page_next_1234567890';
const P_LATEST = 'msg_page_latest_1234567890';
const P_STALE = 'msg_page_stale_1234567890';

const LIST_PAGES = getFunctionName(api.conversation.listPages);
const LIST_PAGE_MESSAGES = getFunctionName(api.conversation.listPageMessages);

interface PageWindowLike {
  pages: {
    pageId: string;
    startedAt: number;
    endExclusive: number | null;
    contentPreview: string;
  }[];
  selectedPageId: string | null;
  prevPageId: string | null;
  nextPageId: string | null;
}

interface PageMessagesBatch {
  page: Message[];
  isDone: boolean;
  continueCursor: string;
}

interface BatchQueryArgs {
  pageId: string;
  paginationOpts: { cursor: string | null };
  [key: string]: unknown;
}

function message(id: string, creationTime: number, overrides: Partial<Message> = {}): Message {
  return {
    _id: id,
    _creationTime: creationTime,
    type: 'message',
    senderRole: 'planner',
    targetRole: 'user',
    content: `content ${id}`,
    ...overrides,
  } as Message;
}

function pageStart(id: string, creationTime: number, content?: string): Message {
  return message(id, creationTime, {
    senderRole: 'user',
    targetRole: 'planner',
    content: content ?? `request ${id}`,
  });
}

function page(
  pageId: string,
  startedAt: number,
  endExclusive: number | null
): PageWindowLike['pages'][number] {
  return { pageId, startedAt, endExclusive, contentPreview: `request ${pageId}` };
}

function windowFor(
  pages: PageWindowLike['pages'],
  selectedPageId: string | null,
  extras: Partial<PageWindowLike> = {}
): PageWindowLike {
  return { pages, selectedPageId, prevPageId: null, nextPageId: null, ...extras };
}

function paginate(all: Message[], cursor: string | null): PageMessagesBatch {
  const start = cursor ? Number(cursor) : 0;
  const batch = all.slice(start, start + 50);
  const next = start + batch.length;
  return { page: batch, isDone: next >= all.length, continueCursor: String(next) };
}

function makeBackend(config: {
  window: PageWindowLike;
  messagesByPage?: Record<string, Message[]>;
  listPageMessages?: (args: BatchQueryArgs, callIndex: number) => PageMessagesBatch;
}) {
  let batchCall = 0;
  const query = vi.fn(async (endpoint: unknown, args: BatchQueryArgs) => {
    const name = getFunctionName(endpoint as never);
    if (name === LIST_PAGES) return config.window;
    if (name === LIST_PAGE_MESSAGES) {
      const callIndex = batchCall++;
      if (config.listPageMessages) return config.listPageMessages(args, callIndex);
      return paginate(config.messagesByPage?.[args.pageId] ?? [], args.paginationOpts.cursor);
    }
    throw new Error('unexpected endpoint');
  });
  return { query };
}

function createFakeFs() {
  const files = new Map<string, string>();
  const writeOrder: string[] = [];
  const rm = vi.fn(() => Effect.void);
  const mkdir = vi.fn(() => Effect.succeed(undefined));
  return {
    files,
    writeOrder,
    writeFile: (path: string, data: string) =>
      Effect.sync(() => {
        files.set(path, data);
        writeOrder.push(path);
      }),
    mkdir,
    rm,
  };
}

function extractError<E>(exit: Exit.Exit<unknown, E>): E | null {
  if (exit._tag !== 'Failure') return null;
  const option = Cause.findErrorOption(exit.cause);
  return option._tag === 'Some' ? option.value : null;
}

async function runDownload(
  config: Parameters<typeof makeBackend>[0],
  options: Parameters<typeof downloadMessagesEffect>[1]
) {
  const fs = createFakeFs();
  const backend = makeBackend(config);
  const layer = Layer.mergeAll(
    commandServicesLayerFromDeps({
      backend: {
        query: backend.query,
        mutation: async () => ({}),
      },
      session: {
        getSessionId: async () => 'sess123' as never,
        getConvexUrl: () => 'http://test:3210',
        getOtherSessionUrls: async () => [],
      },
    }),
    Layer.succeed(MessagesFsService, fs)
  );

  const exit = await Effect.runPromiseExit(
    downloadMessagesEffect(CHATROOM_ID, options).pipe(Effect.provide(layer))
  );
  return { exit, fs, backend };
}

function readManifest(fs: ReturnType<typeof createFakeFs>) {
  const path = [...fs.files.keys()].find((p) => p.endsWith('manifest.json'));
  expect(path).toBeTruthy();
  return JSON.parse(fs.files.get(path as string) as string);
}

function messageFiles(fs: ReturnType<typeof createFakeFs>) {
  return fs.writeOrder.filter((path) => !path.endsWith('manifest.json'));
}

function listPagesArgs(backend: ReturnType<typeof makeBackend>) {
  const call = backend.query.mock.calls.find(
    ([endpoint]) => getFunctionName(endpoint as never) === LIST_PAGES
  );
  return call?.[1] as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveDownloadOutputDir', () => {
  test('resolves an absolute path under cwd without a format level', () => {
    const path = resolveDownloadOutputDir('/home/user/project');
    expect(path).toMatch(/^\/home\/user\/project\/\.chatroom\/downloads\/messages\/[^/]+$/);
    expect(path).not.toMatch(/^\./);
  });
});

describe('downloadMessagesEffect', () => {
  test('regression: a first batch with exactly one message writes it once', async () => {
    const start = pageStart(P1, 1_000);
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        listPageMessages: (_args, callIndex) =>
          callIndex === 0
            ? { page: [start], isDone: false, continueCursor: 'c1' }
            : { page: [], isDone: true, continueCursor: '' },
      },
      { role: 'builder' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.messages.map((m: { id: string }) => m.id)).toEqual([P1]);
    expect(messageFiles(fs)).toHaveLength(1);
  });

  test('pages through 120 messages in 50-row batches without duplicates', async () => {
    const all = [
      pageStart(P1, 1_000),
      ...Array.from({ length: 119 }, (_, i) => message(`msg_timeline_${i}`, 1_001 + i)),
    ];
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: all },
      },
      { role: 'builder' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    const ids = manifest.messages.map((m: { id: string }) => m.id);
    expect(ids).toEqual(all.map((m) => m._id));
    expect(new Set(ids).size).toBe(120);
    expect(messageFiles(fs)).toHaveLength(120);
  });

  test('downloads the latest page by default', async () => {
    const start = pageStart(P_LATEST, 5_000);
    const timeline = message('msg_latest_timeline', 5_001);
    const { exit, fs, backend } = await runDownload(
      {
        window: windowFor([page(P_LATEST, 5_000, null)], P_LATEST),
        messagesByPage: { [P_LATEST]: [start, timeline] },
      },
      { role: 'builder' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.messages.map((m: { id: string }) => m.id)).toEqual([
      P_LATEST,
      'msg_latest_timeline',
    ]);
    const args = listPagesArgs(backend);
    expect(args).toMatchObject({ before: 0, after: 0 });
    expect(args.pageId).toBeUndefined();
  });

  test('--before=1 adds the previous page with matching boundary', async () => {
    const start1 = pageStart(P1, 1_000);
    const timeline1 = message('msg_p1_timeline', 1_001);
    const start2 = pageStart(P2, 2_000);
    const timeline2 = message('msg_p2_timeline', 2_001);
    const { exit, fs, backend } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, 2_000), page(P2, 2_000, null)], P2),
        messagesByPage: { [P1]: [start1, timeline1], [P2]: [start2, timeline2] },
      },
      { role: 'builder', before: '1' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.pages.map((p: { pageId: string }) => p.pageId)).toEqual([P1, P2]);
    expect(manifest.pages[0].endExclusive).toBe(manifest.pages[1].startedAt);
    expect(manifest.pages[0].endExclusive).toBe(new Date(2_000).toISOString());
    expect(manifest.messages.map((m: { id: string }) => m.id)).toEqual([
      P1,
      'msg_p1_timeline',
      P2,
      'msg_p2_timeline',
    ]);
    expect(listPagesArgs(backend)).toMatchObject({ before: 1, after: 0 });
  });

  test('--page-id with --after=1 adds the next page', async () => {
    const startMid = pageStart(P_MID, 1_000);
    const startNext = pageStart(P_NEXT, 2_000);
    const { exit, fs, backend } = await runDownload(
      {
        window: windowFor([page(P_MID, 1_000, 2_000), page(P_NEXT, 2_000, null)], P_MID),
        messagesByPage: { [P_MID]: [startMid], [P_NEXT]: [startNext] },
      },
      { role: 'builder', pageId: P_MID, after: '1' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.messages.map((m: { id: string }) => m.id)).toEqual([P_MID, P_NEXT]);
    expect(listPagesArgs(backend)).toMatchObject({
      pageId: P_MID,
      before: 0,
      after: 1,
    });
  });

  test('open-page guard excludes a newer start and completes the page', async () => {
    const start = pageStart(P1, 1_000);
    const timeline = message('msg_timeline', 1_001);
    const newerStart = pageStart('msg_newer_start_1234567890', 1_002);
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: [start, timeline, newerStart] },
      },
      { role: 'builder' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.messages.map((m: { id: string }) => m.id)).toEqual([P1, 'msg_timeline']);
    expect(manifest.pages[0]).toMatchObject({ pageId: P1, messageCount: 2, complete: true });
  });

  test('truncates at --max-messages and suggests the doubled cap', async () => {
    const all = [pageStart(P1, 1_000), message('msg_t1', 1_001), message('msg_t2', 1_002)];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: all },
      },
      { role: 'builder', maxMessages: '2' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.count).toBe(2);
    expect(manifest.complete).toBe(false);
    expect(manifest.truncated).toBe(true);
    expect(manifest.pages[0]).toMatchObject({ pageId: P1, messageCount: 2, complete: false });
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('--max-messages=4');
  });

  test('at the absolute cap prints the limit line instead of a repeated command', async () => {
    const total = 5_001;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        listPageMessages: (args) => {
          const start = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
          const page_: Message[] = [];
          for (let index = start; index < Math.min(start + 50, total); index += 1) {
            page_.push(
              index === 0 ? pageStart(P1, 1_000) : message(`msg_cap_${index}`, 1_000 + index)
            );
          }
          const next = start + page_.length;
          return { page: page_, isDone: next >= total, continueCursor: String(next) };
        },
      },
      { role: 'builder', maxMessages: '5000' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.count).toBe(5_000);
    expect(manifest.truncated).toBe(true);
    const output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('the 5000-message limit was reached');
    expect(output).not.toContain('--max-messages=5000');
  });

  test('does not report truncation when the cap lands exactly at the end', async () => {
    const all = [pageStart(P1, 1_000), message('msg_t1', 1_001)];
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: all },
      },
      { role: 'builder', maxMessages: '2' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(manifest.count).toBe(2);
    expect(manifest.complete).toBe(true);
    expect(manifest.truncated).toBe(false);
    expect(manifest.pages[0].complete).toBe(true);
  });

  test('prints the no-pages line and writes nothing for an empty chatroom', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { exit, fs } = await runDownload({ window: windowFor([], null) }, { role: 'builder' });

    expect(exit._tag).toBe('Success');
    expect(log.mock.calls[0]?.[0]).toBe('📭 No pages: this chatroom has no user messages yet.');
    expect(fs.writeOrder).toHaveLength(0);
    expect(fs.rm).not.toHaveBeenCalled();
  });

  test('writes the documented manifest shape', async () => {
    const start = pageStart(P1, 1_000);
    const handoff = message('msg_handoff', 1_001, {
      type: 'handoff',
      senderRole: 'planner',
      targetRole: 'user',
      senderAgent: { harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' },
    });
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: [start, handoff] },
      },
      { role: 'builder', pageId: P1 }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    expect(Object.keys(manifest).sort()).toEqual(
      [
        'chatroomId',
        'downloadedAt',
        'format',
        'selection',
        'pages',
        'prevPageId',
        'nextPageId',
        'count',
        'complete',
        'truncated',
        'oldestDownloadedAt',
        'newestDownloadedAt',
        'messages',
      ].sort()
    );
    expect(Object.keys(manifest.selection).sort()).toEqual(['after', 'before', 'pageId']);
    expect(Object.keys(manifest.pages[0]).sort()).toEqual(
      ['pageId', 'startedAt', 'endExclusive', 'messageCount', 'complete'].sort()
    );
    expect(Object.keys(manifest.messages[1]).sort()).toEqual(
      ['id', 'file', 'createdAt', 'pageId', 'senderRole', 'targetRole', 'senderAgent'].sort()
    );
  });

  test('retains the senderAgent snapshot in the manifest and linear header', async () => {
    const legacyRow = pageStart(P1, 1_000);
    const handoffRow = message('msg_handoff_snapshot_456', 2_000, {
      type: 'handoff',
      senderRole: 'planner',
      targetRole: 'user',
      senderAgent: { harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' },
    });
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P1, 1_000, null)], P1),
        messagesByPage: { [P1]: [legacyRow, handoffRow] },
      },
      { role: 'builder' }
    );

    expect(exit._tag).toBe('Success');
    const manifest = readManifest(fs);
    const entryFor = (id: string) => manifest.messages.find((m: { id: string }) => m.id === id);
    const fileFor = (id: string) =>
      [...fs.files.entries()].find(([p]) => p.endsWith(entryFor(id).file))?.[1] as string;

    expect(fileFor(handoffRow._id).split('\n')[0]).toBe(
      '1970-01-01T00:00:02.000Z | planner → user | harness=claude-sdk model=anthropic/claude-sonnet-4'
    );
    expect(fileFor(legacyRow._id).split('\n')[0]).toBe('1970-01-01T00:00:01.000Z | user → planner');
    expect(entryFor(handoffRow._id).senderAgent).toStrictEqual(handoffRow.senderAgent);
    expect(entryFor(legacyRow._id)).not.toHaveProperty('senderAgent');
  });

  test('a stale --page-id fails with PageNotFound and writes no files', async () => {
    const { exit, fs } = await runDownload(
      {
        window: windowFor([page(P_LATEST, 1_000, null)], P_LATEST),
        messagesByPage: { [P_LATEST]: [pageStart(P_LATEST, 1_000)] },
      },
      { role: 'builder', pageId: P_STALE }
    );

    expect(extractError(exit)).toEqual({ _tag: 'PageNotFound', pageId: P_STALE });
    expect(fs.writeOrder).toHaveLength(0);
    expect(fs.rm).not.toHaveBeenCalled();
  });
});
