/**
 * Orchestration ingress — incremental feed definition for P9 user-message relay.
 */

import type { OrchestrationIngressSignal } from '@workspace/backend/src/domain/usecase/orchestration/orchestration-ingress-types.js';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { IncrementalFeedDef, FeedPage, SubscribeQueryTarget } from '../types.js';

export interface OrchestrationIngressFeedArgs {
  sessionId: SessionId;
  machineId: string;
}

export const orchestrationIngressFeedDef: IncrementalFeedDef<
  OrchestrationIngressSignal,
  OrchestrationIngressFeedArgs
> = {
  name: 'orchestration-ingress',
  itemKey: (item) => item.revisionKey,
  parseItem: (raw) => raw as OrchestrationIngressSignal,
};

export const orchestrationIngressSubscribeTarget: SubscribeQueryTarget<
  OrchestrationIngressSignal,
  OrchestrationIngressFeedArgs
> = {
  query: api.orchestration.subscribeOrchestrationIngressSince,
  buildArgs: (args, afterKey, limit) => ({
    sessionId: args.sessionId,
    machineId: args.machineId,
    afterKey: afterKey ?? undefined,
    limit,
  }),
  parsePage: (result) => result as FeedPage<OrchestrationIngressSignal>,
};

export const ORCHESTRATION_INGRESS_FEED_LIMIT = 50;

export const ORCHESTRATION_INGRESS_FEED_BUFFER = {
  maxSize: 200,
  dedupe: true,
};
