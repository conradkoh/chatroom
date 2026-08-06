import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export type Publisher = {
  publish(event: OutboundEvent): Promise<void>;
};
