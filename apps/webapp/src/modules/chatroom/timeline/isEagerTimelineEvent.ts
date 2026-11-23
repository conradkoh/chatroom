import type { TimelineEvent } from './types';

/**
 * Eager events render fully expanded: user messages, context dividers, and any non-plan
 * team message that involves the `user` role (user as sender, or user as target for
 * handoffs and `notify-user` notices). Agent-to-agent team messages and every plan message
 * collapse into a summary bar; a plan collapses even when targeted at the user.
 */
export function isEagerTimelineEvent(event: TimelineEvent): boolean {
  if (event.kind !== 'team_message') return true;
  if (event.message.type === 'plan') return false;
  const { senderRole, targetRole } = event.message;
  return senderRole.toLowerCase() === 'user' || targetRole?.toLowerCase() === 'user';
}
