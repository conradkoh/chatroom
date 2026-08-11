import type { ConvexClient } from 'convex/browser';

import { startEnhancerJobSubscriber } from './job-subscriber.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { RemoteAgentService } from '../../infrastructure/local/harness/services/remote-agent-service.js';

export function startEnhancerSubscriptions(
  sessionId: string,
  machineId: string,
  convexUrl: string,
  wsClient: ConvexClient,
  backend: BackendOps,
  agentServices: Map<string, RemoteAgentService>
): { stop: () => void } {
  return startEnhancerJobSubscriber(
    sessionId,
    machineId,
    convexUrl,
    wsClient,
    backend,
    agentServices
  );
}
