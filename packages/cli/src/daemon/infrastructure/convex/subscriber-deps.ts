import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

export type ConvexSubscriberDeps = {
  wsClient: ConvexClient;
  sessionId: SessionId;
  machineId: string;
  chatroomId?: string;
};
