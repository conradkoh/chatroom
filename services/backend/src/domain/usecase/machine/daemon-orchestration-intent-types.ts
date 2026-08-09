/**
 * Daemon orchestration intent — shared types for the P7 user-message intent feed.
 *
 * Wire shapes for the incremental-sync subscribe feed consumed by the daemon.
 */

import type { Id } from '../../../../convex/_generated/dataModel';

export type DaemonOrchestrationIntentSignal = {
  revisionKey: string;
  machineId: string;
  chatroomId: string;
  taskId: string;
  messageId: string;
  role: string;
  intentType: 'user_message';
  agentHarness: string;
  workingDir?: string;
  model?: string;
  createdAt: number;
};

export type SubscribeDaemonOrchestrationIntentsInput = {
  machineId: string;
  userId?: Id<'users'>;
  afterKey?: string;
  limit: number;
};

export type SubscribeDaemonOrchestrationIntentsResult = {
  items: DaemonOrchestrationIntentSignal[];
  highKey: string | null;
  hasMore: boolean;
};
