import type { TimelineEvent } from '../../timeline/types';

/** Default row height estimate for @tanstack/react-virtual (~20 visible rows in typical panel). */
export const TIMELINE_ESTIMATE_SIZE = 100;

export const TIMELINE_OVERSCAN = 5;

/** Load older history when the first visible row is within this index of the top. */
export const TIMELINE_LOAD_OLDER_INDEX_THRESHOLD = 2;

export function getTimelineItemKey(index: number, events: TimelineEvent[]): string {
  return events[index]?.id ?? String(index);
}
