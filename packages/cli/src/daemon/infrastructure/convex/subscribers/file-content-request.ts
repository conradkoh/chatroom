// fallow-ignore-file code-duplication
import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps, SubscriberHandle } from '../subscriber-deps.js';
import {
  drainPendingRequestSnapshotDedup,
  pendingConvexId,
  type PendingRowWithId,
} from './pending-file-request-dedup.js';

interface PendingFileRequest extends PendingRowWithId {
  workingDir?: string;
  filePath?: string;
  updatedAt?: number;
}

function contentRequestSnapshot(req: PendingFileRequest): string {
  return `${pendingConvexId(req)}:${req.workingDir ?? ''}:${req.filePath ?? ''}:${req.updatedAt ?? 0}`;
}

export function startFileContentRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const last = new Map<string, string>();

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.getPendingFileContentRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (requests: PendingFileRequest[] | null) => {
      for (const id of drainPendingRequestSnapshotDedup(requests, last, contentRequestSnapshot))
        onEvent({ type: 'file-content.request', requestId: id });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] file-content-request subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
