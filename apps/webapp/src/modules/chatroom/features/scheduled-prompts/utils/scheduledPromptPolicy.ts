import type { Doc } from '@workspace/backend/convex/_generated/dataModel';
import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import {
  normalizeTaskEnvelope,
  type TaskSessionPolicy,
} from '@workspace/shared/domain/task-envelope';

/** The two user-facing delivery toggles a scheduled prompt is created or edited with. */
export interface ScheduledPromptPolicy {
  conversationMode: ConversationMode;
  sessionPolicy: TaskSessionPolicy;
}

/**
 * Policy for a fresh form that was not opened from the composer. Matches the
 * server's create default (services/backend/convex/scheduledPrompts.ts `create`).
 */
export const DEFAULT_SCHEDULED_PROMPT_POLICY: ScheduledPromptPolicy = {
  conversationMode: 'code',
  sessionPolicy: 'new',
};

/**
 * Effective policy of a stored row. Rows without an envelope (created before the
 * policy existed) fire as code + new session, mirroring `effectiveEnvelope` in
 * services/backend/convex/scheduledPrompts.ts.
 */
export function scheduledPromptPolicy(
  row: Pick<Doc<'chatroom_scheduledPrompts'>, 'taskEnvelope'>
): ScheduledPromptPolicy {
  const envelope = normalizeTaskEnvelope({
    taskEnvelope: row.taskEnvelope,
    startInNewSession: true,
  });
  return { conversationMode: envelope.conversationMode, sessionPolicy: envelope.sessionPolicy };
}

/** Read-only summary shown next to the toggles and on cards, e.g. "New session · Code". */
export function formatScheduledPromptPolicy(policy: ScheduledPromptPolicy): string {
  const session = policy.sessionPolicy === 'new' ? 'New session' : 'Existing session';
  const mode = policy.conversationMode === 'chat' ? 'Chat' : 'Code';
  return `${session} · ${mode}`;
}

/**
 * Only the fields that differ between `from` and `to`. An edit sends just what the
 * user changed, so it never overwrites a concurrent sidebar toggle it did not touch.
 */
export function changedPolicyFields(
  from: ScheduledPromptPolicy,
  to: ScheduledPromptPolicy
): Partial<ScheduledPromptPolicy> {
  return {
    ...(to.conversationMode !== from.conversationMode
      ? { conversationMode: to.conversationMode }
      : {}),
    ...(to.sessionPolicy !== from.sessionPolicy ? { sessionPolicy: to.sessionPolicy } : {}),
  };
}
