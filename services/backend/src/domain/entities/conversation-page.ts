// The page API and CLI land in later phases; until then this module is only
// consumed by its co-located test.
// fallow-ignore-file unused-file

/**
 * Conversation Page — the only definition of what starts a page, plus the
 * page constants shared by the backend and CLI.
 *
 * Page invariants:
 *
 * 1. Identity is the start message `_id`. There is no page table or column.
 * 2. A page start satisfies {@link startsPage}: `senderRole === 'user'` and
 *    `type === 'message'`.
 * 3. A page covers `_creationTime ∈ [startedAt, endExclusive)` in `by_chatroom`
 *    order, where `endExclusive` is the next start's `_creationTime`, or `null`
 *    for the open latest page.
 * 4. Page content is the rows in that range where `isTimelineMessageType(type)`
 *    is true.
 * 5. Pages are contiguous, non-overlapping, and ordered by `_creationTime`.
 *    Rows before the first start belong to no page.
 * 6. `prevPageId` / `nextPageId` are the adjacent starts.
 * 7. A queued user message is not a start until it is promoted to a row.
 * 8. `_creationTime` is unique per chatroom (existing assumption).
 *
 * Note: Convex pagination's `page` field is a fetch batch, not a domain page.
 */

import type { Message } from './message';

export const PAGE_START_SENDER_ROLE = 'user' as const;
export const PAGE_START_TYPE = 'message' as const;
export const PAGE_PREVIEW_MAX_CHARS = 120;
/** Max before/after page span for listPages. */
export const MAX_PAGE_SPAN = 50;

/**
 * Exact match, so it agrees with the equality prefix of
 * `by_chatroom_senderRole_type_createdAt`.
 */
export function startsPage(m: Pick<Message, 'senderRole' | 'type'>): boolean {
  return m.senderRole === PAGE_START_SENDER_ROLE && m.type === PAGE_START_TYPE;
}

export interface PageRef {
  /** `_id` of the start message. */
  pageId: string;
  /** Start message `_creationTime`. */
  startedAt: number;
  /** Next start's `_creationTime`; `null` = open latest page. */
  endExclusive: number | null;
  /** First `PAGE_PREVIEW_MAX_CHARS` characters of the start content. */
  contentPreview: string;
}
