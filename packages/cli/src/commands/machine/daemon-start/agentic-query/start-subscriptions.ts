import type { ConvexClient } from 'convex/browser';

import { startPromptSubscriber } from './prompt-subscriber.js';
import { startSessionSubscriber } from './session-subscriber.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { SessionId } from '../types.js';

export interface AgenticQuerySubscriptionSession {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
  convexUrl: string;
}

export interface AgenticQuerySubscriptionHandles {
  pendingPromptSubscriptionHandle: { stop: () => void };
  pendingHarnessSessionSubscriptionHandle: { stop: () => void };
}

export function startAgenticQuerySubscriptions(
  session: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  activeSessions: Map<string, ActiveSession>,
  harnesses: Map<string, BoundHarness>
): AgenticQuerySubscriptionHandles {
  const pendingPromptSubscriptionHandle = startPromptSubscriber(
    session,
    wsClient,
    activeSessions,
    harnesses
  );
  const pendingHarnessSessionSubscriptionHandle = startSessionSubscriber(
    session,
    wsClient,
    activeSessions,
    harnesses
  );

  return {
    pendingPromptSubscriptionHandle,
    pendingHarnessSessionSubscriptionHandle,
  };
}
