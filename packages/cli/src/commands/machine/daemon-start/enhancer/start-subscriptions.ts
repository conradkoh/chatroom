import type { ConvexClient } from 'convex/browser';

import type { RemoteAgentService } from '../../../../infrastructure/services/remote-agents/remote-agent-service.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { startEnhancerJobSubscriber } from './job-subscriber.js';

export function startEnhancerSubscriptions(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  backend: BackendOps,
  wsClient: ConvexClient,
  agentServices: Map<string, RemoteAgentService>
): { stop: () => void } {
  return startEnhancerJobSubscriber(
    sessionId,
    machineId,
    convexUrl,
    backend,
    wsClient,
    agentServices
  );
}
