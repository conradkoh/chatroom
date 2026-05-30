import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_OVERSCAN = 5;

/** Load older history when the first visible row is within this index of the top. */
export const TIMELINE_LOAD_OLDER_INDEX_THRESHOLD = 2;

/** Purge distant prepended history when the first visible row exceeds this index (while pinned). */
export const TIMELINE_PURGE_INDEX_THRESHOLD = 50;

/** Matches ScrollController AT_BOTTOM_THRESHOLD — used for followOnAppend / isAtEnd. */
export const TIMELINE_SCROLL_END_THRESHOLD = 50;

export function getTimelineItemKey(index: number, events: TimelineEvent[]): string {
  return events[index]?.id ?? String(index);
}
