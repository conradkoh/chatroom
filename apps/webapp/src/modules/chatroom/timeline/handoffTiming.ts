import type { Message } from '../types/message';

/**
 * Returns the time elapsed between a handoff and the message that immediately
 * precedes it in the loaded timeline. Only handoffs carry a duration; a handoff
 * with no predecessor (first row of the window) or a negative/non-finite gap has none.
 */
// fallow-ignore-next-line complexity
export function getHandoffDurationMs(
  message: Message,
  previousMessage: Message | undefined
): number | undefined {
  if (message.type !== 'handoff' || !previousMessage) return undefined;

  const durationMs = message._creationTime - previousMessage._creationTime;
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
}

/** Formats a historical handoff duration using the compact timeline notation. */
export function formatHandoffDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Minimum number of defined durations in the loaded window before any row can be "slow". */
// fallow-ignore-next-line unused-export
export const SLOW_HANDOFF_MIN_SAMPLES = 4;
/** A duration is slow when it is at least this many times the window median... */
// fallow-ignore-next-line unused-export
export const SLOW_HANDOFF_MEDIAN_MULTIPLIER = 3;
/** ...and at least this long, so uniformly fast conversations never flag anything. */
// fallow-ignore-next-line unused-export
export const SLOW_HANDOFF_FLOOR_MS = 30_000;

/**
 * Threshold at or above which a handoff duration counts as "much longer than typical
 * in this view", or `undefined` when there are too few samples to judge. `durationsMs`
 * may contain `undefined` entries (rows without a duration); they are ignored. Does
 * not mutate its input.
 */
export function getSlowHandoffThresholdMs(
  durationsMs: readonly (number | undefined)[]
): number | undefined {
  const defined = durationsMs.filter((d): d is number => d !== undefined);
  if (defined.length < SLOW_HANDOFF_MIN_SAMPLES) return undefined;
  const sorted = [...defined].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.max(SLOW_HANDOFF_MEDIAN_MULTIPLIER * median, SLOW_HANDOFF_FLOOR_MS);
}

/** True iff the row has a duration and the window has a threshold it meets (`>=`). */
export function isSlowHandoffDuration(
  durationMs: number | undefined,
  thresholdMs: number | undefined
): boolean {
  return durationMs !== undefined && thresholdMs !== undefined && durationMs >= thresholdMs;
}

/** Tooltip text for the duration span. */
export function formatHandoffDurationTitle(durationMs: number, slow: boolean): string {
  const base = `Time since previous message: ${formatHandoffDuration(durationMs)}`;
  return slow ? `${base} (much longer than typical in this view)` : base;
}
