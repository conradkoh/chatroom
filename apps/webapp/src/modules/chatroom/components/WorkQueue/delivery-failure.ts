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
 * `redelivery_exhausted` = the agent ended its turn without a handoff (uncovered-turn pause).
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
        text: 'Delivery paused — agent finished without a handoff',
        title: 'The agent ended its turn without handing off. Restart the agent to resume.',
      };
    default:
      return {
        text: `Delivery failed: ${reason.replaceAll('_', ' ')}`,
        title: `Delivery failed: ${reason}`,
      };
  }
}
