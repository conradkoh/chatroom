import type { TimelineEvent } from './types';

/** Plan and grounding rows are immutable records: they always collapse into a summary bar. */
function isStructuralRecord(type: string): boolean {
  return type === 'plan' || type === 'grounding';
}

/** True when the `user` role is the sender or the target of a team message. */
function involvesUser(message: { senderRole: string; targetRole?: string }): boolean {
  return (
    message.senderRole.toLowerCase() === 'user' || message.targetRole?.toLowerCase() === 'user'
  );
}

/**
 * Eager events render fully expanded: user messages, context dividers, and any non-plan
 * team message that involves the `user` role (user as sender, or user as target for
 * handoffs and `notify-user` notices). Agent-to-agent team messages, every plan message
 * and every grounding message collapse into a summary bar; a plan or grounding collapses
 * even when targeted at the user.
 */
export function isEagerTimelineEvent(event: TimelineEvent): boolean {
  if (event.kind !== 'team_message') return true;
  if (isStructuralRecord(event.message.type)) return false;
  return involvesUser(event.message);
}
