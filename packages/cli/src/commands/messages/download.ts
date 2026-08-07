import * as nodePath from 'node:path';

import { Effect, Layer } from 'effect';

import type { MessagesError } from './index.js';
import {
  buildLinearMessageContent,
  messageFilename,
  MessagesFsService,
  MessagesFsServiceLive,
} from './messages-fs-service.js';
import { api } from '../../api.js';
import {
  BackendService,
  requireSessionIdEffect,
  validateChatroomIdEffect,
  commandServicesLayerFromDeps,
  type BackendServiceShape,
} from '../../infrastructure/services/index.js';

const PAGE_SIZE = 50;
const SINCE_PAGE_SIZE = 500;
const ABSOLUTE_MAX = 5000;
const DEFAULT_LIMIT = 10;

export interface DownloadMessagesOptions {
  role: string;
  format?: 'linear';
  outputDir?: string;
  limit?: number;
  /** Anchor message id — download history from this message onward (ascending) instead of newest-N backward. */
  sinceMessageId?: string;
}

type DownloadMessage = {
  _id: string;
  _creationTime: number;
  senderRole: string;
  type: string;
  content: string;
  targetRole?: string | null;
  taskStatus?: string | null;
};

export type DownloadMessagesError =
  | MessagesError
  | { readonly _tag: 'OutputDirError'; readonly cause: Error }
  | { readonly _tag: 'WriteFailed'; readonly path: string; readonly cause: Error };

function parseLimit(raw: number | undefined): number {
  const cap = raw ?? DEFAULT_LIMIT;
  if (!Number.isFinite(cap) || cap < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(cap), ABSOLUTE_MAX);
}

export function resolveDownloadOutputDir(format: string, cwd: string = process.cwd()): string {
  const downloadId = new Date().toISOString().replace(/[:.]/g, '-');
  return nodePath.resolve(cwd, '.chatroom', 'downloads', 'messages', format, downloadId);
}

type FetchResult = {
  messages: DownloadMessage[];
  truncated: boolean;
  hasMore: boolean;
};

/** Forward fetch: messages from the anchor onward (oldest first), reusing listSinceMessage. */
const fetchForwardSince = (
  args: {
    sessionId: string;
    chatroomId: string;
    sinceMessageId: string;
    maxDownload: number;
  },
  backend: BackendServiceShape
): Effect.Effect<FetchResult, Error> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const messages: DownloadMessage[] = [];
    let cursor: string = args.sinceMessageId;
    let reachedEnd = false;
    let truncated = false;
    while (messages.length < args.maxDownload && !reachedEnd) {
      const remaining = args.maxDownload - messages.length;
      const pageSize = Math.min(SINCE_PAGE_SIZE, remaining);
      const batch = yield* backend.query<DownloadMessage[]>(api.messages.listSinceMessage, {
        sessionId: args.sessionId,
        chatroomId: args.chatroomId,
        sinceMessageId: cursor,
        limit: pageSize,
      });
      if (batch.length === 0) {
        reachedEnd = true;
        break;
      }
      // listSinceMessage is inclusive of the reference message — drop the re-fetched anchor.
      const toAppend = cursor === args.sinceMessageId ? batch : batch.slice(1);
      if (toAppend.length === 0) {
        reachedEnd = true;
        break;
      }
      messages.push(...toAppend);
      if (messages.length >= args.maxDownload) {
        truncated = true;
        break;
      }
      cursor = toAppend[toAppend.length - 1]._id;
    }
    return { messages, truncated, hasMore: !reachedEnd };
  });

/** Backward fetch: newest-N messages using getLatestMessages + listMessagesBefore. */
const fetchLatestBackward = (
  args: {
    sessionId: string;
    chatroomId: string;
    maxDownload: number;
  },
  backend: BackendServiceShape
): Effect.Effect<FetchResult, Error> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const messages: DownloadMessage[] = [];
    let truncated = false;
    let hasMore = true;

    const firstPageSize = Math.min(PAGE_SIZE, args.maxDownload);
    const latest = yield* backend.query<{ messages: DownloadMessage[]; hasMore: boolean }>(
      api.messageList.getLatestMessages,
      { sessionId: args.sessionId, chatroomId: args.chatroomId, limit: firstPageSize }
    );
    messages.push(...latest.messages);
    hasMore = latest.hasMore;

    while (hasMore && messages.length < args.maxDownload) {
      const oldest = messages[0];
      if (!oldest) {
        hasMore = false;
        break;
      }
      const remaining = args.maxDownload - messages.length;
      const pageSize = Math.min(PAGE_SIZE, remaining);
      const batch = yield* backend.query<DownloadMessage[]>(api.messageList.listMessagesBefore, {
        sessionId: args.sessionId,
        chatroomId: args.chatroomId,
        before: oldest._creationTime,
        limit: pageSize,
      });
      if (batch.length === 0) {
        hasMore = false;
        break;
      }
      const space = args.maxDownload - messages.length;
      const toPrepend = batch.slice(Math.max(0, batch.length - space));
      for (let i = toPrepend.length - 1; i >= 0; i--) messages.unshift(toPrepend[i]);
      hasMore = batch.length >= pageSize && messages.length < args.maxDownload;
      if (messages.length >= args.maxDownload && (batch.length >= pageSize || latest.hasMore))
        truncated = true;
      if (toPrepend.length < batch.length) truncated = true;
    }

    return { messages, truncated, hasMore };
  });

// fallow-ignore-next-line unused-export
export const downloadMessagesEffect = (chatroomId: string, options: DownloadMessagesOptions) =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    // Mirrors sibling messages commands: session + chatroom validation before the query.
    // fallow-ignore-next-line code-duplication
    const backend = yield* BackendService;
    const fs = yield* MessagesFsService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));
    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const format = options.format ?? 'linear';
    const maxDownload = parseLimit(options.limit);
    const outputDir = options.outputDir ?? resolveDownloadOutputDir(format);
    const absoluteOutputDir = nodePath.resolve(outputDir);

    const { messages, truncated, hasMore } = yield* options.sinceMessageId
      ? fetchForwardSince(
          {
            sessionId,
            chatroomId,
            sinceMessageId: options.sinceMessageId,
            maxDownload,
          },
          backend
        )
      : fetchLatestBackward({ sessionId, chatroomId, maxDownload }, backend);

    const complete = !truncated && !hasMore;

    // Clean output dir
    yield* fs
      .rm(outputDir, { recursive: true, force: true })
      .pipe(Effect.catchAll(() => Effect.void));
    yield* fs
      .mkdir(outputDir, { recursive: true })
      .pipe(Effect.mapError((cause): DownloadMessagesError => ({ _tag: 'OutputDirError', cause })));

    // Write per-message files
    const manifestEntries: {
      id: string;
      file: string;
      createdAt: string;
      senderRole: string;
      targetRole?: string | null;
    }[] = [];
    for (const msg of messages) {
      const file = messageFilename(msg);
      const content = buildLinearMessageContent(msg);
      const filePath = nodePath.join(outputDir, file);
      yield* fs.writeFile(filePath, content).pipe(
        Effect.mapError((cause): DownloadMessagesError => ({
          _tag: 'WriteFailed',
          path: filePath,
          cause,
        }))
      );
      manifestEntries.push({
        id: msg._id,
        file,
        createdAt: new Date(msg._creationTime).toISOString(),
        senderRole: msg.senderRole,
        targetRole: msg.targetRole,
      });
    }

    // Write manifest
    const manifest = {
      chatroomId,
      downloadedAt: new Date().toISOString(),
      count: messages.length,
      complete,
      truncated,
      sinceMessageId: options.sinceMessageId ?? null,
      anchorMessageId: options.sinceMessageId ?? null,
      oldestDownloadedAt: messages[0] ? new Date(messages[0]._creationTime).toISOString() : null,
      newestDownloadedAt: messages[messages.length - 1]
        ? new Date(messages[messages.length - 1]._creationTime).toISOString()
        : null,
      messages: manifestEntries,
    };
    const manifestPath = nodePath.join(outputDir, 'manifest.json');
    yield* fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)).pipe(
      Effect.mapError((cause): DownloadMessagesError => ({
        _tag: 'WriteFailed',
        path: manifestPath,
        cause,
      }))
    );

    yield* Effect.sync(() => {
      console.log(`\n✅ Downloaded ${messages.length} messages to:`);
      console.log(`   ${absoluteOutputDir}`);
      console.log(`   complete=${complete} truncated=${truncated}`);
      console.log(`\n💡 Read recent history:`);
      console.log(`   ls "${absoluteOutputDir}/"`);
      console.log(`   cat "${absoluteOutputDir}/manifest.json"`);
      console.log(`   rg "pattern" "${absoluteOutputDir}/"`);
      if (truncated) {
        const nextLimit = Math.min(messages.length * 2, ABSOLUTE_MAX);
        console.log(`\n💡 Truncated — fetch more history by increasing --limit:`);
        console.log(
          `   chatroom messages download --chatroom-id=${chatroomId} --role=${options.role} --format=linear --limit=${nextLimit}${
            options.sinceMessageId ? ` --since-message-id=${options.sinceMessageId}` : ''
          }`
        );
      }
      if (!options.sinceMessageId && !options.limit) {
        console.log(`\n💡 Anchor on the user's last message for proof of verification:`);
        console.log(
          `   chatroom messages anchor --chatroom-id=${chatroomId} --role=${options.role}`
        );
        console.log(
          `   Then download history since that anchor: messages download --since-message-id=<id> from anchor output`
        );
      }
    });
  });

// Mirrors sibling messages command entry points (auth storage + convex client wiring).
// fallow-ignore-next-line code-duplication
export async function downloadMessages(
  chatroomId: string,
  options: DownloadMessagesOptions,
  deps?: { backend: any; session: any }
): Promise<void> {
  const { getSessionId, getOtherSessionUrls } =
    await import('../../infrastructure/auth/storage.js');
  const { getConvexClient, getConvexUrl } = await import('../../infrastructure/convex/client.js');
  const client = await getConvexClient();
  const actualDeps = deps ?? {
    backend: {
      mutation: (ep: any, args: any) => client.mutation(ep, args),
      query: (ep: any, args: any) => client.query(ep, args),
    },
    session: { getSessionId, getConvexUrl, getOtherSessionUrls },
  };
  const layer = commandServicesLayerFromDeps(actualDeps);

  // Mirrors sibling messages command error handlers.
  // fallow-ignore-next-line code-duplication
  const handler = (err: any): Effect.Effect<void> => {
    return Effect.sync(() => {
      if (err._tag === 'NotAuthenticated') {
        console.error(`❌ Not authenticated`);
        process.exit(1);
      } else if (err._tag === 'InvalidChatroomId') {
        console.error(`❌ Invalid chatroom ID`);
        process.exit(1);
      } else if (err._tag === 'QueryFailed') {
        console.error(`\n❌ Error fetching messages: ${err.cause.message}`);
        process.exit(1);
      } else if (err._tag === 'OutputDirError') {
        console.error(`\n❌ Failed to create output directory: ${err.cause.message}`);
        process.exit(1);
      } else if (err._tag === 'WriteFailed') {
        console.error(`\n❌ Failed to write ${err.path}: ${err.cause.message}`);
        process.exit(1);
      } else {
        console.error(`\n❌ Download failed: ${err.message}`);
        process.exit(1);
      }
    });
  };

  await Effect.runPromise(
    downloadMessagesEffect(chatroomId, options).pipe(
      Effect.catchAll(handler),
      Effect.provide(Layer.mergeAll(layer, MessagesFsServiceLive))
    )
  );
}
