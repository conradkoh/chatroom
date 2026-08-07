import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface PendingGitRequest {
  _id: string | { toString(): string };
}

function requestId(req: PendingGitRequest): string {
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

export function startGitRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  const unsub = deps.wsClient.onUpdate(
    api.workspaces.getPendingRequests,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    // fallow-ignore-next-line complexity
    (requests: PendingGitRequest[] | null) => {
      if (!requests?.length) return;
      for (const req of requests) {
        if (req == null || typeof req !== 'object' || !('_id' in req)) continue;
        const id = requestId(req);
        if (seen.has(id)) continue;
        seen.add(id);
        onEvent({ type: 'git.request', requestId: id });
      }
    },
    (err: unknown) => {
      console.warn(
        `[daemon] git-request subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
