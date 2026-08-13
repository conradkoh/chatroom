import type { OutboundEvent } from '../entities/outbound-event.js';

export type HandoffCompletedEvent = Extract<OutboundEvent, { type: 'handoff.completed' }>;

export function buildHandoffCompletedEvent(
  fields: Omit<HandoffCompletedEvent, 'type'>
): HandoffCompletedEvent {
  return { type: 'handoff.completed', ...fields };
}
