/**
 * `messages download` — write the selected page range to files plus a manifest.
 *
 * The command resolves one page window through `conversation.listPages`, then
 * pages through `conversation.listPageMessages` per page. It never re-queries
 * by message id, so the old duplicate-anchor defect cannot recur.
 */

import * as nodePath from 'node:path';

import { startsPage, type PageRef } from '@workspace/backend/src/domain/entities/conversation-page';
import type { Message } from '@workspace/backend/src/domain/entities/message';
import { serializeMessage } from '@workspace/backend/src/domain/usecase/message/serialize-message';
import { Effect, Layer } from 'effect';

import type { MessagesError } from './errors.js';
import { messagesCommandLayer, messagesErrorLine } from './errors.js';
import {
  messageFilename,
  MessagesFsService,
  MessagesFsServiceLive,
  type MessagesFsServiceShape,
} from './messages-fs-service.js';
import {
  parsePageSelection,
  resolvePageRange,
  type PageSelection,
  type PageSelectionError,
} from './page-selection.js';
import { api, type Id } from '../../api.js';
import {
  BackendService,
  requireSessionForChatroomEffect,
  type BackendServiceShape,
  type CommandServicesDeps,
} from '../../infrastructure/services/index.js';

/** Convex pagination's `page` is a fetch batch, not a domain page. */
const FETCH_BATCH_SIZE = 50;
const DEFAULT_MAX_MESSAGES = 500;
const ABSOLUTE_MAX_MESSAGES = 5000;

export interface DownloadMessagesOptions {
  role: string;
  pageId?: string | undefined;
  /** Raw commander value. */
  before?: string | undefined;
  /** Raw commander value. */
  after?: string | undefined;
  /**
   * Raw commander value. `packages/cli/src/index.ts` rejects non-positive-integer
   * input first (exit 1); `clampMaxMessages` keeps the same rule for programmatic
   * callers.
   */
  maxMessages?: string | undefined;
  outputDir?: string | undefined;
}

export type DownloadMessagesError =
  | MessagesError
  | PageSelectionError
  | { readonly _tag: 'OutputDirError'; readonly cause: Error }
  | { readonly _tag: 'WriteFailed'; readonly path: string; readonly cause: Error };

export function resolveDownloadOutputDir(cwd: string = process.cwd()): string {
  const downloadId = new Date().toISOString().replace(/[:.]/g, '-');
  return nodePath.resolve(cwd, '.chatroom', 'downloads', 'messages', downloadId);
}

/**
 * Default and ceiling for `--max-messages`. `packages/cli/src/index.ts` rejects
 * non-positive-integer input first (exit 1, "must be a positive integer"); this
 * keeps the same rule for programmatic callers so an invalid value never disables the cap.
 */
function clampMaxMessages(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_MESSAGES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_MAX_MESSAGES;
  return Math.min(parsed, ABSOLUTE_MAX_MESSAGES);
}

interface Collected {
  message: Message;
  pageId: string;
}

interface PageSummary {
  pageId: string;
  startedAt: string;
  endExclusive: string | null;
  messageCount: number;
  complete: boolean;
}

interface FetchResult {
  collected: Collected[];
  pageSummaries: PageSummary[];
  truncated: boolean;
}

interface PageMessagesBatch {
  page: Message[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Fetches every page in the window, ascending, in `FETCH_BATCH_SIZE` batches.
 *
 * The open-page guard stops a page when a newer start message appears, even
 * when the server has not reached the page boundary yet. Page summaries cover
 * every page that was reached; the page in progress when the cap is hit is
 * recorded with `complete: false`.
 */
function fetchWindowPages(
  backend: BackendServiceShape,
  args: {
    sessionId: string;
    chatroomId: string;
    pages: PageRef[];
    maxMessages: number;
  }
): Effect.Effect<FetchResult, Error> {
  // fallow-ignore-next-line complexity
  return Effect.gen(function* () {
    const collected: Collected[] = [];
    const pageSummaries: PageSummary[] = [];
    let truncated = false;

    pageLoop: for (const page of args.pages) {
      let cursor: string | null = null;
      let messageCount = 0;
      let pageComplete = false;

      for (;;) {
        const batch: PageMessagesBatch = yield* backend.query<PageMessagesBatch>(
          api.conversation.listPageMessages,
          {
            sessionId: args.sessionId,
            chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
            pageId: page.pageId as Id<'chatroom_messages'>,
            endExclusive: page.endExclusive,
            paginationOpts: { numItems: FETCH_BATCH_SIZE, cursor },
          }
        );

        for (const message of batch.page) {
          // A newer start ends this page even if the range is not exhausted.
          if (startsPage(message) && message._id !== page.pageId) {
            pageComplete = true;
            break;
          }
          if (collected.length >= args.maxMessages) {
            truncated = true;
            break;
          }
          collected.push({ message, pageId: page.pageId });
          messageCount += 1;
        }

        if (truncated || pageComplete) break;
        if (batch.isDone) {
          pageComplete = true;
          break;
        }
        cursor = batch.continueCursor;
      }

      pageSummaries.push({
        pageId: page.pageId,
        startedAt: new Date(page.startedAt).toISOString(),
        endExclusive: page.endExclusive === null ? null : new Date(page.endExclusive).toISOString(),
        messageCount,
        complete: pageComplete,
      });

      if (truncated) break pageLoop;
    }

    return { collected, pageSummaries, truncated };
  });
}

interface ManifestEntry {
  id: string;
  file: string;
  createdAt: string;
  pageId: string;
  senderRole: string;
  targetRole: string | null;
  senderAgent: Message['senderAgent'];
}

function pageSelectorFlags(selection: {
  pageId: string | undefined;
  before: number;
  after: number;
}) {
  const flags: string[] = [];
  if (selection.pageId !== undefined) flags.push(`--page-id=${selection.pageId}`);
  if (selection.before > 0) flags.push(`--before=${selection.before}`);
  if (selection.after > 0) flags.push(`--after=${selection.after}`);
  return flags.length > 0 ? ` ${flags.join(' ')}` : '';
}

function prepareOutputDir(
  fs: MessagesFsServiceShape,
  outputDir: string
): Effect.Effect<void, DownloadMessagesError> {
  return Effect.gen(function* () {
    yield* fs.rm(outputDir, { recursive: true, force: true }).pipe(Effect.catch(() => Effect.void));
    yield* fs
      .mkdir(outputDir, { recursive: true })
      .pipe(Effect.mapError((cause): DownloadMessagesError => ({ _tag: 'OutputDirError', cause })));
  });
}

function writeMessageFiles(args: {
  fs: MessagesFsServiceShape;
  outputDir: string;
  collected: Collected[];
  chatroomId: string;
  role: string;
}): Effect.Effect<ManifestEntry[], DownloadMessagesError> {
  return Effect.gen(function* () {
    const entries: ManifestEntry[] = [];
    for (const { message, pageId } of args.collected) {
      const file = messageFilename(message);
      const content = serializeMessage(message, {
        profile: 'linear',
        chatroomId: args.chatroomId,
        role: args.role,
      });
      const filePath = nodePath.join(args.outputDir, file);
      yield* args.fs.writeFile(filePath, content).pipe(
        Effect.mapError((cause): DownloadMessagesError => ({
          _tag: 'WriteFailed',
          path: filePath,
          cause,
        }))
      );
      entries.push({
        id: message._id,
        file,
        createdAt: new Date(message._creationTime).toISOString(),
        pageId,
        senderRole: message.senderRole,
        targetRole: message.targetRole ?? null,
        senderAgent: message.senderAgent,
      });
    }
    return entries;
  });
}

function buildManifest(args: {
  chatroomId: string;
  selection: PageSelection;
  pageSummaries: PageSummary[];
  prevPageId: string | null;
  nextPageId: string | null;
  collected: Collected[];
  truncated: boolean;
  messages: ManifestEntry[];
}) {
  const oldest = args.collected[0];
  const newest = args.collected[args.collected.length - 1];
  return {
    chatroomId: args.chatroomId,
    downloadedAt: new Date().toISOString(),
    format: 'linear',
    selection: {
      pageId: args.selection.pageId ?? null,
      before: args.selection.before,
      after: args.selection.after,
    },
    pages: args.pageSummaries,
    prevPageId: args.prevPageId,
    nextPageId: args.nextPageId,
    count: args.collected.length,
    complete: !args.truncated,
    truncated: args.truncated,
    oldestDownloadedAt: oldest ? new Date(oldest.message._creationTime).toISOString() : null,
    newestDownloadedAt: newest ? new Date(newest.message._creationTime).toISOString() : null,
    messages: args.messages,
  };
}

function writeManifest(
  fs: MessagesFsServiceShape,
  outputDir: string,
  manifest: ReturnType<typeof buildManifest>
): Effect.Effect<void, DownloadMessagesError> {
  const manifestPath = nodePath.join(outputDir, 'manifest.json');
  return fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)).pipe(
    Effect.mapError((cause): DownloadMessagesError => ({
      _tag: 'WriteFailed',
      path: manifestPath,
      cause,
    }))
  );
}

function printDownloadSummary(args: {
  chatroomId: string;
  role: string;
  absoluteOutputDir: string;
  count: number;
  pageCount: number;
  truncated: boolean;
  maxMessages: number;
  selection: PageSelection;
  prevPageId: string | null;
  nextPageId: string | null;
}): Effect.Effect<void> {
  return Effect.sync(() => {
    console.log(`\n✅ Downloaded ${args.count} messages from ${args.pageCount} page(s) to:`);
    console.log(`   ${args.absoluteOutputDir}`);
    console.log(`   complete=${!args.truncated} truncated=${args.truncated}`);
    console.log(`\n💡 Read recent history:`);
    console.log(`   ls "${args.absoluteOutputDir}/"`);
    console.log(`   # ls lists the newest file first; manifest.json lists messages oldest first`);
    console.log(`   cat "${args.absoluteOutputDir}/manifest.json"`);
    console.log(`   rg "pattern" "${args.absoluteOutputDir}/"`);
    if (args.truncated) {
      if (args.maxMessages >= ABSOLUTE_MAX_MESSAGES) {
        console.log(
          `\n💡 Truncated: the ${ABSOLUTE_MAX_MESSAGES}-message limit was reached. Select a narrower page with --page-id, --before or --after to read the rest.`
        );
      } else {
        const nextMax = Math.min(args.count * 2, ABSOLUTE_MAX_MESSAGES);
        console.log(
          `\n💡 Truncated at --max-messages=${args.maxMessages}. Fetch more with: chatroom messages download --chatroom-id=${args.chatroomId} --role=${args.role} --max-messages=${nextMax}${pageSelectorFlags(args.selection)}`
        );
      }
    }
    if (args.prevPageId) {
      console.log(`💡 Earlier page: --page-id=${args.prevPageId}`);
    }
    if (args.nextPageId) {
      console.log(`💡 Later page: --page-id=${args.nextPageId}`);
    }
  });
}

// fallow-ignore-next-line unused-export
export const downloadMessagesEffect = (chatroomId: string, options: DownloadMessagesOptions) =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const fs = yield* MessagesFsService;

    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const selection = yield* parsePageSelection(
      { pageId: options.pageId, before: options.before, after: options.after },
      { before: 0, after: 0 }
    );
    const maxMessages = clampMaxMessages(options.maxMessages);
    const window = yield* resolvePageRange(backend, {
      sessionId,
      chatroomId,
      ...selection,
    });

    if (window.pages.length === 0) {
      yield* Effect.sync(() => {
        console.log('📭 No pages: this chatroom has no user messages yet.');
      });
      return;
    }

    // Fetch everything before touching the filesystem so a query failure
    // leaves the output directory untouched.
    const { collected, pageSummaries, truncated } = yield* fetchWindowPages(backend, {
      sessionId,
      chatroomId,
      pages: window.pages,
      maxMessages,
    });

    const outputDir = options.outputDir ?? resolveDownloadOutputDir();
    const absoluteOutputDir = nodePath.resolve(outputDir);

    yield* prepareOutputDir(fs, outputDir);
    const messages = yield* writeMessageFiles({
      fs,
      outputDir,
      collected,
      chatroomId,
      role: options.role,
    });
    const manifest = buildManifest({
      chatroomId,
      selection,
      pageSummaries,
      prevPageId: window.prevPageId,
      nextPageId: window.nextPageId,
      collected,
      truncated,
      messages,
    });
    yield* writeManifest(fs, outputDir, manifest);

    yield* printDownloadSummary({
      chatroomId,
      role: options.role,
      absoluteOutputDir,
      count: collected.length,
      pageCount: pageSummaries.length,
      truncated,
      maxMessages,
      selection,
      prevPageId: window.prevPageId,
      nextPageId: window.nextPageId,
    });
  });

export async function downloadMessages(
  chatroomId: string,
  options: DownloadMessagesOptions,
  deps?: CommandServicesDeps
): Promise<void> {
  const layer = await messagesCommandLayer(deps);

  // fallow-ignore-next-line code-duplication
  const handler = (err: Error | DownloadMessagesError): Effect.Effect<void> => {
    return Effect.sync(() => {
      const line = messagesErrorLine(err, chatroomId, options.role);
      if (line !== null) {
        console.error(line);
        process.exit(1);
      }
      const tagged = err as DownloadMessagesError;
      if (tagged._tag === 'OutputDirError') {
        console.error(`\n❌ Failed to create output directory: ${tagged.cause.message}`);
        process.exit(1);
      } else if (tagged._tag === 'WriteFailed') {
        console.error(`\n❌ Failed to write ${tagged.path}: ${tagged.cause.message}`);
        process.exit(1);
      } else {
        console.error(`\n❌ Download failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
  };

  await Effect.runPromise(
    downloadMessagesEffect(chatroomId, options).pipe(
      Effect.catch(handler),
      Effect.provide(Layer.mergeAll(layer, MessagesFsServiceLive))
    )
  );
}
