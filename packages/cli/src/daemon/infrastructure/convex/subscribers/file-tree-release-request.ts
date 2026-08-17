// fallow-ignore-file code-duplication complexity
import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingReleaseRequest {
  _id?: string | { toString(): string } | null;
  workingDir?: string;
  updatedAt?: number;
}

function requestId(req: PendingReleaseRequest): string {
  if (req._id == null) return 'unknown';
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

function pendingReleasesSnapshot(requests: PendingReleaseRequest[]): string {
  return requests
    .filter((req) => req != null && typeof req === 'object')
    .map((req) => `${requestId(req)}:${req.workingDir ?? ''}:${req.updatedAt ?? 0}`)
    .sort()
    .join('|');
}

export function startFileTreeReleaseRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let lastSnapshot = '';

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.getPendingFileTreeReleaseRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    (requests: PendingReleaseRequest[] | null) => {
      if (!requests?.length) {
        lastSnapshot = '';
        return;
      }

      const snapshot = pendingReleasesSnapshot(requests);
      if (!snapshot || snapshot === lastSnapshot) return;
      lastSnapshot = snapshot;

      const first = requests.find((req) => req != null && typeof req === 'object');
      if (!first) return;

      onEvent({ type: 'file-tree.release', requestId: requestId(first) });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] file-tree-release subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
