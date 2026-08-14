/**
 * Timestamp formatting helpers shared by timeline and other chatroom UI.
 */

import { DateTime } from 'luxon';

/** e.g. 12 → "12th" */
function ordinalDay(day: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return `${day}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

/** e.g. "12th June, 10:00pm" */
function formatChatroomTimestamp(ms: number, includeYear: boolean): string {
  const dt = DateTime.fromMillis(ms);
  const datePart = includeYear
    ? `${ordinalDay(dt.day)} ${dt.toFormat('MMMM yyyy')}`
    : `${ordinalDay(dt.day)} ${dt.toFormat('MMMM')}`;
  const timePart = dt.toFormat('h:mma').toLowerCase();
  return `${datePart}, ${timePart}`;
}

/** Format a Unix millisecond timestamp for timeline rows (ordinal day, full month, 12-hour time). */
export function formatTimestamp(ms: number): string {
  const dt = DateTime.fromMillis(ms);
  const includeYear = dt.year !== DateTime.now().year;
  return formatChatroomTimestamp(ms, includeYear);
}
