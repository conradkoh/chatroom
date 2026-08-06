import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingFileRequest {
  _id: string | { toString(): string };
}

function requestId(req: PendingFileRequest): string {
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

export function startFileContentRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.workspaceFiles.getPendingFileContentRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (requests: PendingFileRequest[] | null) => {
      if (!requests?.length) return;
      for (const req of requests) {
        if (req == null || typeof req !== 'object' || !('_id' in req)) continue;
        const id = requestId(req);
        if (seen.has(id)) continue;
        seen.add(id);
        onEvent({ type: 'file-content.request', requestId: id });
      }
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
