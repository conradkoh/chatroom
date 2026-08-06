import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createModelsPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'models.updated') return;

      await deps.backend.mutation(api.machines.refreshCapabilities, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        availableModels: event.availableModels,
        availableHarnesses: event.availableHarnesses,
        harnessVersions: event.harnessVersions,
      });
    },
  };
}
