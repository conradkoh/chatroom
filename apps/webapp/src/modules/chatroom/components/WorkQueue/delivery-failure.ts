export type DeliveryFailureReason =
  | 'no_agent_config'
  | 'unsupported_harness'
  | 'injection_not_confirmed'
  | 'task_not_deliverable'
  | 'assigned_elsewhere'
  | 'redelivery_exhausted'
  | 'delivery_retrying';

/**
 * Visible `text` and tooltip `title` for a delivery failure.
 * `delivery_retrying` = provider failures still being retried with backoff (warning, not an error).
 * `redelivery_exhausted` = automatic redelivery stopped. Stored by the old provider cap and by the
 * uncovered-turn park, so the copy names neither cause.
 */
export function describeDeliveryFailure(reason: DeliveryFailureReason): {
  text: string;
  title: string;
} {
  switch (reason) {
    case 'delivery_retrying':
      return {
        text: 'Retrying delivery — something may be wrong',
        title:
          'Delivery has failed more than 3 times and is still being retried (up to once a minute). Check the agent and its provider.',
      };
    case 'redelivery_exhausted':
      return {
        text: 'Delivery paused — restart the agent to resume',
        title:
          'Automatic redelivery stopped for this task (repeated failures or a turn without a handoff). Restart the agent to resume.',
      };
    default:
      return {
        text: `Delivery failed: ${reason.replaceAll('_', ' ')}`,
        title: `Delivery failed: ${reason}`,
      };
  }
}

/**
 * Whether a delivery failure renders for a task in this status. A completed task never shows
 * the retry warning: its clear is best effort and can be lost, so the row can outlive the
 * retries. Every other reason renders on a completed task as before.
 */
export function isDeliveryFailureVisible(status: string, reason: DeliveryFailureReason): boolean {
  return !(status === 'completed' && reason === 'delivery_retrying');
}
