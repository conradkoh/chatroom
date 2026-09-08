import type { Message } from '../types/message';

/**
 * Returns the persisted duration represented by a handoff, when its origin is
 * present in the already-loaded timeline window.
 */
// fallow-ignore-next-line complexity
export function getHandoffDurationMs(
  message: Message,
  messagesById: ReadonlyMap<string, Message>
): number | undefined {
  if (message.type !== 'handoff' || !message.taskOriginMessageId) return undefined;

  const origin = messagesById.get(message.taskOriginMessageId);
  if (!origin) return undefined;

  const startedAt = origin.acknowledgedAt ?? origin._creationTime;
  const completedAt = origin.completedAt ?? message._creationTime;
  const durationMs = completedAt - startedAt;

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
