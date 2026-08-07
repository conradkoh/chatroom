import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createHarnessFingerprintPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'harness.fingerprint.updated') return;

      await deps.backend.mutation(api.machines.refreshCapabilities, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        availableHarnesses: event.availableHarnesses,
        harnessVersions: event.harnessVersions,
        availableModels: {},
      });
    },
  };
}
