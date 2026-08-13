import {
  assertProjectableEvent,
  createConvexPublishers,
  routeConvexEvent,
} from './route-outbound-event.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import type { ConvexPublisherDeps } from '../../convex/publishers/publisher-deps.js';

export type ConvexProjectionAdapter = {
  project(event: OutboundEvent): Promise<void>;
  validateProjectable(event: OutboundEvent): void;
};

export function createConvexProjectionAdapter(deps: ConvexPublisherDeps): ConvexProjectionAdapter {
  const publishers = createConvexPublishers(deps);
  return {
    async project(event) {
      const result = routeConvexEvent(publishers, event);
      if (result === undefined) throw new Error(`No handler for ${event.type}`);
      await result;
    },
    validateProjectable(event) {
      assertProjectableEvent(publishers, event);
    },
  };
}
