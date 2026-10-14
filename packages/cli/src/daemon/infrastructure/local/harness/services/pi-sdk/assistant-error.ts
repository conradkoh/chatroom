import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

/** The `message_end` variant of the SDK session event union. */
export type MessageEndEvent = Extract<AgentSessionEvent, { type: 'message_end' }>;

const UNKNOWN_PROVIDER_ERROR = 'unknown provider error';

/**
 * Provider error carried by an assistant `message_end`, or undefined when that message succeeded.
 * Callers check `event.type === 'message_end'` first. Callers that also need successful assistant
 * messages to clear a previous error must do that themselves, since this returns undefined for both.
 */
export function assistantErrorOf(event: MessageEndEvent): string | undefined {
  if (event.message.role !== 'assistant' || event.message.stopReason !== 'error') return undefined;
  return event.message.errorMessage ?? UNKNOWN_PROVIDER_ERROR;
}
