import type { TimelineEvent } from './types';

/**
 * Eager events render fully expanded. Only agent-to-agent team messages collapse.
 *
 * Eager rows are user messages, context dividers, and any team message that
 * involves the `user` role — either as sender (user→agent) or as target
 * (agent→user handoffs and every `notify-user` notice).
 */
export function isEagerTimelineEvent(event: TimelineEvent): boolean {
  if (event.kind !== 'team_message') return true;
  const { senderRole, targetRole } = event.message;
  return senderRole.toLowerCase() === 'user' || targetRole?.toLowerCase() === 'user';
}
