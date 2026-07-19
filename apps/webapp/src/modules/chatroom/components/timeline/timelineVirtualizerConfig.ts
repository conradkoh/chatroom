import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_OVERSCAN = 5;

/**
 * For feeds at or below this count, render with expanded overscan and eagerly
 * measure rows after initial tail settle so the first scroll-up does not shift
 * when estimates are replaced by measured heights.
 */
export const TIMELINE_EAGER_MEASURE_MAX_COUNT = 40;

/**
 * 0-based index of the oldest row that should enter view before prefetching history.
 * Index 2 = the 3rd message from the top (matches release/v1.51.0 threshold).
 */
export const TIMELINE_LOAD_OLDER_SENTINEL_INDEX = 2;

/**
 * Fraction of max scroll range (0–1) within which scroll-driven load-older may fire.
 * Relative to loaded content height so moderate scroll-up from the tail cannot match
 * a fixed pixel band (~600px) while the virtualizer still reports a low index.
 */
export const TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION = 0.1;

/**
 * Whether scroll position + virtual range indicate the user has reached the load-older sentinel.
 * Requires both a low first-visible index and scrollTop in the top fraction of the range so a
 * stale virtual index mid-list or at the bottom cannot trigger an early fetch.
 */
export function shouldTriggerLoadOlder(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  firstVisibleIndex: number;
  topChromeHeight: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, firstVisibleIndex } = input;

  const atBottom = scrollHeight - scrollTop - clientHeight < TIMELINE_SCROLL_END_THRESHOLD;
  if (atBottom) return false;

  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return false;

  const nearTop = scrollTop <= maxScrollTop * TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION;
  const sentinelVisible = firstVisibleIndex <= TIMELINE_LOAD_OLDER_SENTINEL_INDEX;

  return nearTop && sentinelVisible;
}

/** Matches ScrollController AT_BOTTOM_THRESHOLD — TanStack scrollEndThreshold / load-older guards. */
export const TIMELINE_SCROLL_END_THRESHOLD = 50;

/**
 * Stricter DOM threshold for pin / jump-chip UI. A partial scroll (e.g. half the last
 * message still visible) must stay unpinned so "Jump to new messages" remains actionable.
 */
export const TIMELINE_PIN_AT_BOTTOM_THRESHOLD = 8;

/** Extra space after the last row so the tail message is not clipped at the scroll edge. */
export const TIMELINE_PADDING_END = 16;

export function getTimelineItemKey(index: number, events: TimelineEvent[]): string {
  return events[index]?.id ?? String(index);
}

/** Row height estimate for filtered role message list (team/user tabs). */
export const FILTERED_MESSAGE_ESTIMATE_SIZE = 120;
export const FILTERED_MESSAGE_OVERSCAN = 5;

/** Gap between the jump-to-new-messages chip and the timeline footer chrome. */
const JUMP_TO_NEW_MESSAGES_GAP_PX = 8;

/** Bottom CSS px offset so the chip sits above the measured footer chrome. */
export function jumpToNewMessagesBottomOffset(
  footerChromeHeightPx: number,
  gapPx: number = JUMP_TO_NEW_MESSAGES_GAP_PX
): number {
  return Math.max(0, footerChromeHeightPx) + gapPx;
}
