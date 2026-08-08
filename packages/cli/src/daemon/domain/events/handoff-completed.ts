// fallow-ignore-file unused-file
import type { OutboundEvent } from '../entities/outbound-event.js';

export type HandoffCompletedEvent = Extract<OutboundEvent, { type: 'handoff.completed' }>;

// fallow-ignore-next-line unused-export
export function buildHandoffCompletedEvent(
  fields: Omit<HandoffCompletedEvent, 'type'>
): HandoffCompletedEvent {
  return { type: 'handoff.completed', ...fields };
}
