import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_OVERSCAN = 5;

/** 0-based index of the oldest row that should enter view before prefetching history. */
export const TIMELINE_LOAD_OLDER_SENTINEL_INDEX = 2;

/** Fraction of max scroll range (0–1) within which scroll-driven load-older may fire. */
export const TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION = 0.1;

/** Matches ScrollController AT_BOTTOM_THRESHOLD — used for pin / isAtEnd. */
export const TIMELINE_SCROLL_END_THRESHOLD = 50;

/** Extra space after the last row so the tail message is not clipped at the scroll edge. */
export const TIMELINE_PADDING_END = 16;

export function timelineOverscan(_eventCount: number): number {
  return TIMELINE_OVERSCAN;
}

export function shouldTriggerLoadOlder(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  firstVisibleIndex: number;
  topChromeHeight: number;
}): boolean {
  const { scrollTop, scrollHeight, clientHeight, firstVisibleIndex } = input;

  const atBottom =
    scrollHeight - scrollTop - clientHeight < TIMELINE_SCROLL_END_THRESHOLD;
  if (atBottom) return false;

  const maxScrollTop = scrollHeight - clientHeight;
  if (maxScrollTop <= 0) return false;

  const nearTop = scrollTop <= maxScrollTop * TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION;
  const sentinelVisible = firstVisibleIndex <= TIMELINE_LOAD_OLDER_SENTINEL_INDEX;

  return nearTop && sentinelVisible;
}

export function getTimelineItemKey(index: number, events: TimelineEvent[]): string {
  return events[index]?.id ?? String(index);
}
