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
