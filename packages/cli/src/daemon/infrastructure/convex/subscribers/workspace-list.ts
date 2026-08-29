import { OBSERVATION_TTL_MS } from '@workspace/backend/config/reliability.js';

import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

export function startWorkspaceListSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let lastSnapshotKey = '';

  const queryArgs = {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    recencyWindowMs: OBSERVATION_TTL_MS,
  };

  const unsub = deps.wsClient.onUpdate(
    api.workspaces.listRecentlyObservedWorkspacesForMachine,
    queryArgs,
    (workspaces: string[] | null) => {
      if (workspaces == null) return;
      const snapshotKey = JSON.stringify(workspaces);
      if (snapshotKey === lastSnapshotKey) return;
      lastSnapshotKey = snapshotKey;
      onEvent({ type: 'workspace.list-changed', machineId: deps.machineId });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] workspace-list subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
