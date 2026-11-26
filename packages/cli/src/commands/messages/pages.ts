/**
 * `messages pages` — list the page window around the selected page.
 *
 * A page starts at a user message and runs until the next user message. The
 * output shows each page's start id, start time, and a short preview so an
 * agent can choose a page to download.
 */

import { Effect } from 'effect';

import type { MessagesError } from './errors.js';
import { messagesCommandLayer, messagesErrorLine } from './errors.js';
import type { PageSelectionError } from './page-selection.js';
import { parsePageSelection, resolvePageRange } from './page-selection.js';
import {
  BackendService,
  requireSessionForChatroomEffect,
  type CommandServicesDeps,
} from '../../infrastructure/services/index.js';

const DEFAULT_BEFORE = 9;
const DEFAULT_AFTER = 0;

export interface ListPagesOptions {
  role: string;
  pageId?: string | undefined;
  before?: string | undefined;
  after?: string | undefined;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// fallow-ignore-next-line unused-export complexity
export const listPagesEffect = (chatroomId: string, options: ListPagesOptions) =>
  Effect.gen(function* () {
    const backend = yield* BackendService;
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const selection = yield* parsePageSelection(
      { pageId: options.pageId, before: options.before, after: options.after },
      { before: DEFAULT_BEFORE, after: DEFAULT_AFTER }
    );
    const window = yield* resolvePageRange(backend, {
      sessionId,
      chatroomId,
      ...selection,
    });

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      if (window.pages.length === 0) {
        console.log('📭 No pages: this chatroom has no user messages yet.');
        return;
      }

      const lines = [`📄 Pages in chatroom ${chatroomId} (${window.pages.length} shown)`];
      for (const page of window.pages) {
        const tags: string[] = [];
        if (page.endExclusive === null) tags.push('[latest]');
        if (page.pageId === window.selectedPageId) tags.push('[selected]');
        const suffix = tags.length > 0 ? `  ${tags.join('  ')}` : '';
        lines.push(
          `  ${page.pageId}  ${new Date(page.startedAt).toISOString()}  ${collapseWhitespace(page.contentPreview)}${suffix}`
        );
      }
      lines.push(
        `prev page: ${window.prevPageId ?? 'none'}   next page: ${window.nextPageId ?? 'none'}`
      );
      lines.push('');
      lines.push(
        `💡 Download the latest page:  chatroom messages download --chatroom-id=${chatroomId} --role=${options.role}`
      );
      lines.push(
        `💡 Download an older page:    chatroom messages download --chatroom-id=${chatroomId} --role=${options.role} --page-id=<pageId> [--before=<n>] [--after=<n>]`
      );
      console.log(lines.join('\n'));
    });
  });

export async function listPages(
  chatroomId: string,
  options: ListPagesOptions,
  deps?: CommandServicesDeps
): Promise<void> {
  const layer = await messagesCommandLayer(deps);

  // fallow-ignore-next-line code-duplication
  const handler = (err: Error | MessagesError | PageSelectionError): Effect.Effect<void> => {
    return Effect.sync(() => {
      const line = messagesErrorLine(err, chatroomId, options.role);
      if (line !== null) {
        console.error(line);
        process.exit(1);
      }
      console.error(`❌ Failed to list pages: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  };

  await Effect.runPromise(
    listPagesEffect(chatroomId, options).pipe(Effect.catch(handler), Effect.provide(layer))
  );
}
