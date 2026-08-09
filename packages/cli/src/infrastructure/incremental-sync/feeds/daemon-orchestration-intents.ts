/**
 * Daemon orchestration intents — incremental feed definition for P7 user-message
 * intent wake signals.
 */

import type { DaemonOrchestrationIntentSignal } from '@workspace/backend/src/domain/usecase/machine/daemon-orchestration-intent-types.js';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { IncrementalFeedDef, FeedPage, SubscribeQueryTarget } from '../types.js';

export interface DaemonOrchestrationIntentsFeedArgs {
  sessionId: SessionId;
  machineId: string;
}

export const daemonOrchestrationIntentsFeedDef: IncrementalFeedDef<
  DaemonOrchestrationIntentSignal,
  DaemonOrchestrationIntentsFeedArgs
> = {
  name: 'daemon-orchestration-intents',
  itemKey: (item) => item.revisionKey,
  parseItem: (raw) => raw as DaemonOrchestrationIntentSignal,
};

export const daemonOrchestrationIntentsSubscribeTarget: SubscribeQueryTarget<
  DaemonOrchestrationIntentSignal,
  DaemonOrchestrationIntentsFeedArgs
> = {
  query: api.machines.subscribeDaemonOrchestrationIntentsSince,
  buildArgs: (args, afterKey, limit) => ({
    sessionId: args.sessionId,
    machineId: args.machineId,
    afterKey: afterKey ?? undefined,
    limit,
  }),
  parsePage: (result) => result as FeedPage<DaemonOrchestrationIntentSignal>,
};

export const DAEMON_ORCHESTRATION_INTENTS_FEED_LIMIT = 50;

export const DAEMON_ORCHESTRATION_INTENTS_FEED_BUFFER = {
  maxSize: 200,
  dedupe: true,
};
