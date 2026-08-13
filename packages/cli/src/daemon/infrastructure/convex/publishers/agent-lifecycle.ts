import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { mapAgentLifecycleEventToMutation } from '../../projection/convex/mappers/agent-lifecycle.mapper.js';

/**
 * Projects local agent lifecycle events to the matching Convex emit* mutation
 * via the shared mapper. Each event is projected immediately (T3).
 */
export function createAgentLifecyclePublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      const spec = mapAgentLifecycleEventToMutation(deps, event);
      if (!spec) return;
      await deps.backend.mutation(spec.mutation, spec.args);
    },
  };
}
