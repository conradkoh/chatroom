import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { logDaemonAuditEvent } from '../../event-stream/daemon-event-emitter.js';

export function createCommandResultPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      switch (event.type) {
        case 'command.result.ping':
          await logDaemonAuditEvent(deps.logEvent ?? (async () => undefined), {
            type: 'daemon.pong',
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
