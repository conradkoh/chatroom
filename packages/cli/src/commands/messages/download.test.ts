import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { downloadMessagesEffect, resolveDownloadOutputDir } from './download.js';
import { MessagesFsService } from './messages-fs-service.js';
import { commandServicesLayerFromDeps } from '../../infrastructure/services/index.js';

describe('resolveDownloadOutputDir', () => {
  test('resolves absolute path under cwd', () => {
    const path = resolveDownloadOutputDir('linear', '/home/user/project');
    expect(path).toMatch(/^\/home\/user\/project\/\.chatroom\/downloads\/messages\/linear\//);
    expect(path).not.toMatch(/^\./);
  });
});

function createFakeFs() {
  const files = new Map<string, string>();
  return {
    files,
    writeFile: (path: string, data: string) =>
      Effect.sync(() => {
        files.set(path, data);
      }),
    mkdir: () => Effect.succeed(undefined),
    rm: () => Effect.void,
  };
}

const TEST_CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';
const SINCE_MESSAGE_ID = 'msg_since_anchor_1234567';

function sinceMessages() {
  return [
    {
      _id: SINCE_MESSAGE_ID,
      _creationTime: 1_000,
      senderRole: 'user',
      type: 'message',
      content: 'do it',
      targetRole: 'planner',
      taskStatus: null,
    },
    {
      _id: 'msg_since_second_123456',
      _creationTime: 2_000,
      senderRole: 'planner',
      type: 'handoff',
      content: 'done',
      targetRole: 'user',
      taskStatus: null,
    },
  ];
}

function sinceLayer(query: any) {
  return commandServicesLayerFromDeps({
    backend: {
      query,
      mutation: async () => ({}),
    },
    session: {
      getSessionId: async () => 'sess123' as never,
      getConvexUrl: () => 'http://test:3210',
      getOtherSessionUrls: async () => [],
    },
  });
}

describe('downloadMessagesEffect with sinceMessageId', () => {
  // Mirrors backend listSinceMessage semantics: messages from the sinceMessageId
  // onward (inclusive, ascending), capped at the requested limit.
  function makeQuery(ALL: any[]) {
    return vi.fn().mockImplementation(async (_endpoint: unknown, args: any) => {
      const idx = ALL.findIndex((m) => m._id === args.sinceMessageId);
      const start = idx === -1 ? 0 : idx;
      return ALL.slice(start, start + args.limit);
    });
  }

  test('fetches forward history via listSinceMessage and writes manifest with sinceMessageId', async () => {
    const ALL = sinceMessages();
    const query = makeQuery(ALL);
    const fs = createFakeFs();
    const layer = Layer.mergeAll(sinceLayer(query), Layer.succeed(MessagesFsService, fs));

    await Effect.runPromise(
      downloadMessagesEffect(TEST_CHATROOM_ID, {
        role: 'planner',
        limit: 10,
        sinceMessageId: SINCE_MESSAGE_ID,
      }).pipe(Effect.provide(layer))
    );

    const [endpoint, args] = query.mock.calls[0];
    expect(endpoint).toBeDefined();
    expect(args).toMatchObject({
      chatroomId: TEST_CHATROOM_ID,
      sinceMessageId: SINCE_MESSAGE_ID,
      limit: 10,
    });
    expect(args.sessionId).toBe('sess123');

    const manifestPath = [...fs.files.keys()].find((p) => p.endsWith('manifest.json'));
    expect(manifestPath).toBeTruthy();
    const manifestRaw = manifestPath ? fs.files.get(manifestPath) : undefined;
    expect(manifestRaw).toBeTruthy();
    const manifest = JSON.parse(manifestRaw as string);
    expect(manifest.sinceMessageId).toBe(SINCE_MESSAGE_ID);
    expect(manifest.anchorMessageId).toBe(SINCE_MESSAGE_ID);
    expect(manifest.count).toBe(2);
    expect(manifest.complete).toBe(true);
  });

  test('paginates forward by re-anchoring on the last message of each batch', async () => {
    // > SINCE_PAGE_SIZE (500) messages so the download must page across batches.
    const ALL = Array.from({ length: 600 }, (_, i) => ({
      _id: `msg_since_${i}_anchor_1234567`,
      _creationTime: 1_000 + i * 1_000,
      senderRole: i % 2 === 0 ? 'user' : 'planner',
      type: 'message',
      content: `content ${i}`,
      targetRole: 'planner',
      taskStatus: null,
    }));
    const query = makeQuery(ALL);
    const fs = createFakeFs();
    const layer = Layer.mergeAll(sinceLayer(query), Layer.succeed(MessagesFsService, fs));

    await Effect.runPromise(
      downloadMessagesEffect(TEST_CHATROOM_ID, {
        role: 'planner',
        limit: 700,
        sinceMessageId: ALL[0]._id,
      }).pipe(Effect.provide(layer))
    );

    // Page 1: 0..499 (500 messages) → re-anchor on ALL[499]
    // Page 2: 499..599 (clamped to 101) → drops the re-fetched anchor → 100 new, re-anchor on ALL[599]
    // Page 3: 599 only → toAppend empty → reached end
    expect(query).toHaveBeenCalledTimes(3);
    const firstArgs = query.mock.calls[0][1];
    const secondArgs = query.mock.calls[1][1];
    const thirdArgs = query.mock.calls[2][1];
    expect(firstArgs.sinceMessageId).toBe(ALL[0]._id);
    expect(secondArgs.sinceMessageId).toBe(ALL[499]._id);
    expect(thirdArgs.sinceMessageId).toBe(ALL[599]._id);

    const manifestPath = [...fs.files.keys()].find((p) => p.endsWith('manifest.json'));
    const manifestRaw = manifestPath ? fs.files.get(manifestPath) : undefined;
    const manifest = JSON.parse(manifestRaw as string);
    // Anchor counted once, re-fetched anchors on pages 2-3 deduped
    expect(manifest.count).toBe(600);
    expect(manifest.complete).toBe(true);
    expect(manifest.sinceMessageId).toBe(ALL[0]._id);
  });
});
