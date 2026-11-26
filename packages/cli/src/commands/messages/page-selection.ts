/**
 * Page selection shared by `messages pages` and `messages download`.
 *
 * A page is a user message plus every timeline message up to the next user
 * message; its id is the start message `_id`. This module parses the
 * `--page-id` / `--before` / `--after` flags and resolves one page window
 * through a single `conversation.listPages` query.
 */

import {
  MAX_PAGE_SPAN,
  type PageWindow,
} from '@workspace/backend/src/domain/entities/conversation-page';
import { Effect } from 'effect';

import { api, type Id } from '../../api.js';
import type { BackendServiceShape } from '../../infrastructure/services/index.js';
import { getConvexErrorCode } from '../../utils/convex-error.js';

export interface PageSelectionFlags {
  pageId?: string | undefined;
  /** Raw commander value. */
  before?: string | undefined;
  /** Raw commander value. */
  after?: string | undefined;
}

export interface PageSelection {
  pageId: string | undefined;
  before: number;
  after: number;
}

export type PageSelectionError =
  | {
      readonly _tag: 'InvalidPageSelection';
      readonly flag: '--before' | '--after';
      readonly value: string;
    }
  | { readonly _tag: 'PageNotFound'; readonly pageId: string }
  | { readonly _tag: 'InvalidPage'; readonly pageId: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

/**
 * Parses one span flag. A flag is valid when it matches `/^\d+$/` and its
 * value is in `0..MAX_PAGE_SPAN`; a missing value takes the default.
 */
function parsePageSpan(
  flag: '--before' | '--after',
  raw: string | undefined,
  fallback: number
): Effect.Effect<number, PageSelectionError> {
  if (raw === undefined) return Effect.succeed(fallback);
  const value = Number(raw);
  const valid = /^\d+$/.test(raw) && value <= MAX_PAGE_SPAN;
  return valid
    ? Effect.succeed(value)
    : Effect.fail({ _tag: 'InvalidPageSelection', flag, value: raw });
}

/** Integer in `0..MAX_PAGE_SPAN`, else `InvalidPageSelection`. */
export function parsePageSelection(
  flags: PageSelectionFlags,
  defaults: { before: number; after: number }
): Effect.Effect<PageSelection, PageSelectionError> {
  return Effect.gen(function* () {
    const before = yield* parsePageSpan('--before', flags.before, defaults.before);
    const after = yield* parsePageSpan('--after', flags.after, defaults.after);
    return { pageId: flags.pageId, before, after };
  });
}

function mapPageQueryError(cause: Error, pageId: string | undefined): PageSelectionError {
  if (pageId !== undefined) {
    const code = getPageErrorCode(cause);
    if (code === 'INVALID_PAGE') return { _tag: 'InvalidPage', pageId };
    if (code === 'INVALID_MESSAGE') return { _tag: 'PageNotFound', pageId };
  }
  return { _tag: 'QueryFailed', cause };
}

/**
 * Detects the two page-related ConvexError codes. Prefers the structured
 * ConvexError payload, then falls back to a substring match for errors that
 * crossed the wire as a plain message.
 */
function isPageErrorCode(code: string | undefined): code is 'INVALID_PAGE' | 'INVALID_MESSAGE' {
  return code === 'INVALID_PAGE' || code === 'INVALID_MESSAGE';
}

function getPageErrorCode(cause: Error): 'INVALID_PAGE' | 'INVALID_MESSAGE' | undefined {
  const structured = getConvexErrorCode(cause);
  if (isPageErrorCode(structured)) return structured;
  if (cause.message.includes('INVALID_PAGE')) return 'INVALID_PAGE';
  if (cause.message.includes('INVALID_MESSAGE')) return 'INVALID_MESSAGE';
  return undefined;
}

/**
 * Calls `api.conversation.listPages` once and verifies that a requested page
 * still resolves to itself. A deleted page falls back to the latest page on
 * the server, so the id comparison turns that silent fallback into
 * `PageNotFound`.
 */
export const resolvePageRange = (
  backend: BackendServiceShape,
  args: { sessionId: string; chatroomId: string } & PageSelection
): Effect.Effect<PageWindow, PageSelectionError> =>
  Effect.gen(function* () {
    const window = yield* backend
      .query<PageWindow>(api.conversation.listPages, {
        sessionId: args.sessionId,
        chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
        pageId: args.pageId as Id<'chatroom_messages'> | undefined,
        before: args.before,
        after: args.after,
      })
      .pipe(Effect.mapError((cause) => mapPageQueryError(cause, args.pageId)));

    if (args.pageId !== undefined && window.selectedPageId !== args.pageId) {
      return yield* Effect.fail<PageSelectionError>({
        _tag: 'PageNotFound',
        pageId: args.pageId,
      });
    }

    return window;
  });

/** One line per error, naming the command to run next. */
// fallow-ignore-next-line complexity
export function formatPageSelectionError(
  err: PageSelectionError,
  chatroomId: string,
  role: string
): string {
  switch (err._tag) {
    case 'PageNotFound':
      return `❌ Page not found: ${err.pageId}. It was deleted or is not in this chatroom.\n   List current pages: chatroom messages pages --chatroom-id=${chatroomId} --role=${role}`;
    case 'InvalidPage':
      return `❌ ${err.pageId} is not a page start. A page starts at a user message.\n   List pages: chatroom messages pages --chatroom-id=${chatroomId} --role=${role}`;
    case 'InvalidPageSelection':
      return `❌ ${err.flag} must be an integer from 0 to ${MAX_PAGE_SPAN} (got "${err.value}")`;
    case 'QueryFailed':
      return `❌ Error fetching pages: ${err.cause.message}`;
  }
}
