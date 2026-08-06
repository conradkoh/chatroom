import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createWorkspaceCommandsPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'workspace.commands') return;

      await deps.backend.mutation(api.commands.syncCommands, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        workingDir: event.workingDir,
        commands: event.commands,
      });
    },
  };
}
