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
  revision?: number;
  updatedAt?: number;
}

// fallow-ignore-next-line complexity
function writeRequestSnapshot(req: PendingFileRequest): string {
  return `${pendingConvexId(req)}:${req.workingDir ?? ''}:${req.filePath ?? ''}:${req.revision ?? 0}:${req.updatedAt ?? 0}`;
}

export function startFileWriteRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const last = new Map<string, string>();

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.getPendingFileWriteRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (requests: PendingFileRequest[] | null) => {
      for (const id of drainPendingRequestSnapshotDedup(requests, last, writeRequestSnapshot))
        onEvent({ type: 'file-write.request', requestId: id });
    },
    (err: unknown) => {
      console.warn(
        `[daemon] file-write-request subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
