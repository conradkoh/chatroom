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

export type AgentOperation = 'start' | 'restart' | 'stop';

/** The fields of a chatroom agent operation result that the describer reads. */
export interface AgentOperationOutcome {
  requested: readonly unknown[];
  skipped: readonly { role?: string; reason: string }[];
  failed: readonly { role?: string; error: string }[];
}

const REQUESTED_LABEL: Record<AgentOperation, string> = {
  start: 'Start requested',
  restart: 'Restart requested',
  stop: 'Stop requested',
};

const NO_SAVED_CONFIGURATION = 'No saved agent configuration is available.';

/**
 * The backend skip reason for a role with no saved launch configuration. Keep in sync with
 * services/backend/src/domain/usecase/agent/request-chatroom-agent-operation.ts.
 */
const NO_SAVED_LAUNCH_CONFIGURATION = 'No saved launch configuration';

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
 * Nothing requested and nothing failed, for start and restart:
 * - every skip is a missing saved launch configuration (or there are no skips at all): the
 *   no-saved-configuration notice. `every` is vacuously true for an empty list, so one check covers both.
 * - otherwise: the skip reasons, one `role: reason` line per skipped agent, under a failure title.
 * A stop in the same state is silent: the agents are already stopped.
 */
function reportNothingDone(
  operation: AgentOperation,
  requestedCount: number,
  skipped: AgentOperationOutcome['skipped']
): FeedbackDraft | null {
  if (operation === 'stop' || requestedCount > 0) return null;
  if (skipped.every(({ reason }) => reason === NO_SAVED_LAUNCH_CONFIGURATION)) {
    return { tone: 'error', message: NO_SAVED_CONFIGURATION };
  }
  return {
    tone: 'error',
    title: `Failed to ${operation} ${skipped.length} agent(s)`,
    items: skipped.map(({ role, reason }) => failedItem({ role, error: reason })),
  };
}

/**
 * Maps one agent operation result to the feedback to show, or `null` when nothing needs showing.
 * - Pure success (requested, nothing failed, nothing skipped that matters): `null`. The agent status chips show it.
 * - Some failed: error draft. Title is the headline, `message` is the requested summary (only when
 *   some were requested), `items` is one `role: error` line per failure.
 * - Nothing requested, nothing failed: for start and restart, the skip reasons, or the
 *   no-saved-configuration notice when every skip is a missing configuration (or nothing was skipped).
 *   A stop in the same state is silent.
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
  return reportNothingDone(operation, requestedCount, result.skipped);
}
