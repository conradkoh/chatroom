import type { FeedbackTone } from '@/components/inline-feedback';

/** Feedback a surface should show. "Nothing to show" is `null`, never an empty draft. */
export interface FeedbackDraft {
  tone: FeedbackTone;
  message?: string;
  title?: string;
  items?: string[];
}

/** Writes a draft into a feedback slot. `null` clears the slot. */
export type ReportFeedback = (draft: FeedbackDraft | null) => void;

export type AgentOperation = 'start' | 'restart';

/** The fields of a chatroom agent operation result that the describer reads. */
export interface AgentOperationOutcome {
  requested: readonly unknown[];
  failed: readonly { role?: string; error: string }[];
}

const REQUESTED_LABEL: Record<AgentOperation, string> = {
  start: 'Start requested',
  restart: 'Restart requested',
};

const NO_SAVED_CONFIGURATION = 'No saved agent configuration is available.';

function requestedSummary(
  operation: AgentOperation,
  requestedCount: number,
  appliedCount: number
): string {
  const requested = `${REQUESTED_LABEL[operation]} for ${requestedCount} agent(s)`;
  return appliedCount > 0
    ? `Applied favourites to ${appliedCount} agent(s). ${requested}.`
    : requested;
}

function failedItem({ role, error }: { role?: string; error: string }): string {
  return role ? `${role}: ${error}` : error;
}

/**
 * Maps one agent operation result to the feedback to show, or `null` when nothing needs showing.
 * - Pure success (requested, nothing failed): `null`. The agent status chips show it.
 * - Some failed: error draft. Title is the headline, `message` is the requested summary (only when
 *   some were requested), `items` is one `role: error` line per failure.
 * - Nothing requested, nothing failed: error draft with the no-saved-configuration notice.
 * `appliedCount` is only ever shown inside a partial-failure draft.
 */
export function describeAgentOperation(
  result: AgentOperationOutcome,
  operation: AgentOperation,
  appliedCount = 0
): FeedbackDraft | null {
  const requestedCount = result.requested.length;
  if (result.failed.length > 0) {
    return {
      tone: 'error',
      title: `Failed to ${operation} ${result.failed.length} agent(s)`,
      message:
        requestedCount > 0 ? requestedSummary(operation, requestedCount, appliedCount) : undefined,
      items: result.failed.map(failedItem),
    };
  }
  if (requestedCount > 0) return null;
  return { tone: 'error', message: NO_SAVED_CONFIGURATION };
}
