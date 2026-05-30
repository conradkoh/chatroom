import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_OVERSCAN = 5;

/**
 * 0-based index of the oldest row that should enter view before prefetching history.
 * Index 4 = the 5th message from the top of the loaded timeline.
 */
export const TIMELINE_LOAD_OLDER_SENTINEL_INDEX = 4;

/** Extra rows of slack beyond the sentinel when comparing scrollTop to estimates. */
const LOAD_OLDER_SENTINEL_SCROLL_ROWS = 2;

export function getLoadOlderNearTopScrollMax(topChromeHeight: number): number {
  return (
    topChromeHeight +
    TIMELINE_ESTIMATE_SIZE * (TIMELINE_LOAD_OLDER_SENTINEL_INDEX + LOAD_OLDER_SENTINEL_SCROLL_ROWS)
  );
}

/**
 * Whether scroll position + virtual range indicate the user has reached the load-older sentinel.
 * Requires both a low first-visible index and scrollTop near the top so a stale virtual index
 * at the bottom cannot trigger an early fetch.
 */
export function shouldTriggerLoadOlder(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  firstVisibleIndex: number;
  topChromeHeight: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, firstVisibleIndex, topChromeHeight } = input;

  const atBottom =
    scrollHeight - scrollTop - clientHeight < TIMELINE_SCROLL_END_THRESHOLD;
  if (atBottom) return false;

  const nearTop =
    scrollTop < getLoadOlderNearTopScrollMax(topChromeHeight) &&
    firstVisibleIndex <= TIMELINE_LOAD_OLDER_SENTINEL_INDEX;

  return nearTop;
}

/** Matches ScrollController AT_BOTTOM_THRESHOLD — used for followOnAppend / isAtEnd. */
export const TIMELINE_SCROLL_END_THRESHOLD = 50;

/** Extra space after the last row so the tail message is not clipped at the scroll edge. */
export const TIMELINE_PADDING_END = 16;

export function getTimelineItemKey(index: number, events: TimelineEvent[]): string {
  return events[index]?.id ?? String(index);
}
