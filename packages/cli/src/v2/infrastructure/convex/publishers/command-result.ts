import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createCommandResultPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      switch (event.type) {
        case 'command.result.ping':
          await deps.backend.mutation(api.machines.ackPing, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            pingEventId: event.pingEventId,
          });
          break;
        case 'command.result.folder-picker':
          await deps.backend.mutation(api.machines.reportFolderPickerResult, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            requestId: event.requestId,
            status: event.status,
            selectedPath: event.selectedPath,
            errorMessage: event.errorMessage,
          });
          break;
        case 'command.result.capabilities-refresh':
          await deps.backend.mutation(api.machines.reportCapabilitiesRefreshResult, {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
            batchId: event.batchId,
            status: event.status,
            errorMessage: event.errorMessage,
          });
          break;
      }
    },
  };
}
