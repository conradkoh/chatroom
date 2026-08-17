import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingFileRequest {
  _id?: string | { toString(): string } | null;
  workingDir?: string;
  force?: boolean;
  updatedAt?: number;
}

function requestId(req: PendingFileRequest): string {
  if (req._id == null) return 'unknown';
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

function pendingRequestsSnapshot(requests: PendingFileRequest[]): string {
  return requests
    .filter((req) => req != null && typeof req === 'object')
    .map(
      (req) =>
        `${requestId(req)}:${req.workingDir ?? ''}:${req.force ? '1' : '0'}:${req.updatedAt ?? 0}`
    )
    .sort()
    .join('|');
}

export function startFileTreeRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let lastSnapshot = '';

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.getPendingFileTreeRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (requests: PendingFileRequest[] | null) => {
      if (!requests?.length) {
        lastSnapshot = '';
        return;
      }

      const snapshot = pendingRequestsSnapshot(requests);
      if (!snapshot || snapshot === lastSnapshot) return;
      lastSnapshot = snapshot;

      const first = requests.find((req) => req != null && typeof req === 'object');
      if (!first) return;

      onEvent({ type: 'file-tree.request', requestId: requestId(first) });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] file-tree-request subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
