import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createDaemonHeartbeatPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'heartbeat') return;

      await deps.backend.mutation(api.machines.daemonHeartbeat, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      });
    },
  };
}
