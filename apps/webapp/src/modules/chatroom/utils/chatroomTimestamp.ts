import { DateTime } from 'luxon';

function ordinalDay(day: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = day % 100;
  return `${day}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function formatChatroomTimestamp(ms: number, year: boolean): string {
  const dt = DateTime.fromMillis(ms);
  const d = year
    ? `${ordinalDay(dt.day)} ${dt.toFormat('MMMM yyyy')}`
    : `${ordinalDay(dt.day)} ${dt.toFormat('MMMM')}`;
  return `${d}, ${formatTimeOfDay(ms)}`;
}
export function formatTimestamp(ms: number): string {
  const dt = DateTime.fromMillis(ms);
  return formatChatroomTimestamp(ms, dt.year !== DateTime.now().year);
}
export function formatTimestampFull(ms: number): string {
  return formatChatroomTimestamp(ms, true);
}

/** Time of day only (e.g. `2:14pm`); the compact form of {@link formatChatroomTimestamp}'s time part. */
export function formatTimeOfDay(ms: number): string {
  return DateTime.fromMillis(ms).toFormat('h:mma').toLowerCase();
}
