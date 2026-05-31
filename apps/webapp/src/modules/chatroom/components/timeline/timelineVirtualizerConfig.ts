import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_ROW_BASE_USER = 56;
export const TIMELINE_ROW_BASE_TEAM = 72;
export const TIMELINE_ROW_BASE_CONTEXT = 48;
export const TIMELINE_ROW_LINE_HEIGHT = 22;
export const TIMELINE_ROW_CHARS_PER_LINE = 60;
export const TIMELINE_ROW_CODE_BLOCK_BIAS = 80;
export const TIMELINE_ROW_MIN_ESTIMATE = 40;
export const TIMELINE_ROW_MAX_ESTIMATE = 1200;

export const TIMELINE_OVERSCAN = 10;

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

/**
 * Cheap content-derived row-height estimate (no DOM, no rendering).
 * Used by useVirtualizer.estimateSize and CSS contain-intrinsic-size so the
 * scrollbar/thumb position and contain reservation are roughly correct
 * BEFORE the row has been measured. TanStack still re-measures on mount.
 */
export function estimateTimelineRowSize(event: TimelineEvent | undefined): number {
  if (!event) return TIMELINE_ESTIMATE_SIZE;
  if (event.kind === 'context') return TIMELINE_ROW_BASE_CONTEXT;

  const text = String(event.message?.content ?? '');
  const explicitNewlines = text.match(/\n/g)?.length ?? 0;
  const wrappedLines = Math.ceil(text.length / TIMELINE_ROW_CHARS_PER_LINE);
  const lines = Math.max(1, explicitNewlines + wrappedLines);

  const codeBlocks = Math.floor((text.match(/```/g)?.length ?? 0) / 2);
  const base = event.kind === 'user_message' ? TIMELINE_ROW_BASE_USER : TIMELINE_ROW_BASE_TEAM;

  const raw = base + lines * TIMELINE_ROW_LINE_HEIGHT + codeBlocks * TIMELINE_ROW_CODE_BLOCK_BIAS;
  return Math.min(TIMELINE_ROW_MAX_ESTIMATE, Math.max(TIMELINE_ROW_MIN_ESTIMATE, raw));
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
