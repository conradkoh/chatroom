import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

export function startFileTreeReleaseRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let lastRevision: number | null = null;

  const maybeWake = (revision: number, requestId: string): void => {
    if (lastRevision === revision) return;
    lastRevision = revision;
    onEvent({ type: 'file-tree.release', requestId });
  };

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.subscribeMachineFileTreeReleaseHead,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    (head: { revision: number } | null) => {
      if (!head) {
        lastRevision = null;
        return;
      }
      maybeWake(head.revision, `rev-${head.revision}`);
    },
    (err: unknown) => {
      console.warn(
        `[daemon] file-tree-release head subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  // Drain rows queued before the wake-up head existed (for example, before deployment).
  void deps.wsClient
    .query(api.workspaceFiles.getPendingFileTreeReleaseRequests, {
      sessionId: deps.sessionId,
      machineId: deps.machineId,
    })
    .then((requests) => {
      if (requests?.length) onEvent({ type: 'file-tree.release', requestId: 'startup' });
    })
    .catch((err: unknown) => {
      console.warn(
        `[daemon] file-tree-release startup drain check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });

  return {
    async stop() {
      unsub();
    },
  };
}
