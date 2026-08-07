import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createGitStatePublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'git.state') return;

      await deps.backend.mutation(api.workspaces.upsertWorkspaceGitState, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        workingDir: event.workingDir,
        ...event.payload,
      });
    },
  };
}
