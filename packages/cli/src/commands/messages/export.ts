import { Effect, Layer } from 'effect';
import * as nodePath from 'node:path';

import {
  buildMessageMarkdown,
  buildTranscriptMarkdown,
  messageFilename,
  MessagesFsService,
} from './messages-fs-service.js';
import type { MessagesError } from './index.js';
import { api, type Id } from '../../api.js';
import {
  BackendService,
  requireSessionIdEffect,
  validateChatroomIdEffect,
  SessionService,
  commandServicesLayerFromDeps,
} from '../../infrastructure/services/index.js';
import { MessagesFsServiceLive } from './messages-fs-service.js';

const PAGE_SIZE = 50;
const ABSOLUTE_MAX = 5000;

export interface ExportMessagesOptions {
  role: string;
  outputDir?: string;
  limit?: number;
}

type ExportMessage = {
  _id: string;
  _creationTime: number;
  senderRole: string;
  type: string;
  content: string;
  targetRole?: string | null;
  classification?: string | null;
  taskStatus?: string | null;
  featureTitle?: string | null;
};

export type ExportMessagesError =
  | MessagesError
  | { readonly _tag: 'OutputDirError'; readonly cause: Error }
  | { readonly _tag: 'WriteFailed'; readonly path: string; readonly cause: Error };

function parseLimit(raw: number | undefined): number {
  const cap = raw ?? ABSOLUTE_MAX;
  if (!Number.isFinite(cap) || cap < 1) return ABSOLUTE_MAX;
  return Math.min(Math.floor(cap), ABSOLUTE_MAX);
}

// fallow-ignore-next-line unused-export
export const exportMessagesEffect = (chatroomId: string, options: ExportMessagesOptions) =>
  Effect.gen(function* () {
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

    const maxExport = parseLimit(options.limit);
    const outputDir = options.outputDir ?? nodePath.join('.chatroom', 'exports', chatroomId);

    // Fetch messages
    const messages: ExportMessage[] = [];
    let truncated = false;
    let hasMore = true;

    // First page
    const firstPageSize = Math.min(PAGE_SIZE, maxExport);
    const latest = yield* backend.query<{ messages: ExportMessage[]; hasMore: boolean }>(
      api.messageList.getLatestMessages,
      { sessionId, chatroomId, limit: firstPageSize }
    );
    messages.push(...latest.messages);
    hasMore = latest.hasMore;

    // Subsequent pages
    while (hasMore && messages.length < maxExport) {
      const oldest = messages[0];
      if (!oldest) {
        hasMore = false;
        break;
      }
      const remaining = maxExport - messages.length;
      const pageSize = Math.min(PAGE_SIZE, remaining);
      const batch = yield* backend.query<ExportMessage[]>(api.messageList.listMessagesBefore, {
        sessionId,
        chatroomId,
        before: oldest._creationTime,
        limit: pageSize,
      });
      if (batch.length === 0) {
        hasMore = false;
        break;
      }
      const space = maxExport - messages.length;
      const toPrepend = batch.slice(Math.max(0, batch.length - space));
      for (let i = toPrepend.length - 1; i >= 0; i--) messages.unshift(toPrepend[i]);
      hasMore = batch.length >= pageSize && messages.length < maxExport;
      if (messages.length >= maxExport && (batch.length >= pageSize || latest.hasMore))
        truncated = true;
      if (toPrepend.length < batch.length) truncated = true;
    }

    const complete = !truncated && !hasMore;

    // Clean output dir
    yield* fs
      .rm(outputDir, { recursive: true, force: true })
      .pipe(Effect.catchAll(() => Effect.void));
    yield* fs
      .mkdir(outputDir, { recursive: true })
      .pipe(Effect.mapError((cause): ExportMessagesError => ({ _tag: 'OutputDirError', cause })));

    // Write per-message files
    const manifestEntries: Array<{
      id: string;
      file: string;
      createdAt: string;
      senderRole: string;
    }> = [];
    for (const msg of messages) {
      const file = messageFilename(msg);
      const md = buildMessageMarkdown(msg);
      const filePath = nodePath.join(outputDir, file);
      yield* fs
        .writeFile(filePath, md)
        .pipe(
          Effect.mapError(
            (cause): ExportMessagesError => ({ _tag: 'WriteFailed', path: filePath, cause })
          )
        );
      manifestEntries.push({
        id: msg._id,
        file,
        createdAt: new Date(msg._creationTime).toISOString(),
        senderRole: msg.senderRole,
      });
    }

    // Write transcript
    const transcriptPath = nodePath.join(outputDir, 'transcript.md');
    yield* fs
      .writeFile(transcriptPath, buildTranscriptMarkdown(messages))
      .pipe(
        Effect.mapError(
          (cause): ExportMessagesError => ({ _tag: 'WriteFailed', path: transcriptPath, cause })
        )
      );

    // Write manifest
    const manifest = {
      chatroomId,
      exportedAt: new Date().toISOString(),
      count: messages.length,
      complete,
      truncated,
      oldestExportedAt: messages[0] ? new Date(messages[0]._creationTime).toISOString() : null,
      newestExportedAt: messages[messages.length - 1]
        ? new Date(messages[messages.length - 1]._creationTime).toISOString()
        : null,
      messages: manifestEntries,
    };
    const manifestPath = nodePath.join(outputDir, 'manifest.json');
    yield* fs
      .writeFile(manifestPath, JSON.stringify(manifest, null, 2))
      .pipe(
        Effect.mapError(
          (cause): ExportMessagesError => ({ _tag: 'WriteFailed', path: manifestPath, cause })
        )
      );

    yield* Effect.sync(() => {
      console.log(`\n✅ Exported ${messages.length} messages to ${outputDir}`);
      console.log(`   complete=${complete} truncated=${truncated}`);
      console.log(`\n💡 Grep examples:`);
      console.log(`   rg "pattern" ${outputDir}/`);
      console.log(`   rg -C 3 "pattern" ${outputDir}/transcript.md`);
    });
  });

export async function exportMessages(
  chatroomId: string,
  options: ExportMessagesOptions,
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
        console.error(`\n❌ Export failed: ${err.message}`);
        process.exit(1);
      }
    });
  };

  await Effect.runPromise(
    exportMessagesEffect(chatroomId, options).pipe(
      Effect.catchAll(handler),
      Effect.provide(Layer.mergeAll(layer, MessagesFsServiceLive))
    )
  );
}
