/**
 * P9 orchestration ingress — shared types for the ephemeral Convex ingress relay.
 */

import type { Id } from '../../../../convex/_generated/dataModel';

export type OrchestrationIngressSnippet = {
  reference: string;
  fileSource: string;
  selectedContent: string;
};

export type OrchestrationIngressSignal = {
  revisionKey: string;
  ingressId: string;
  machineId: string;
  chatroomId: Id<'chatroom_rooms'>;
  content: string;
  senderRole: 'user';
  targetRole?: string;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
  attachedMessageIds?: Id<'chatroom_messages'>[];
  attachedSnippets?: OrchestrationIngressSnippet[];
  sourcePlatform?: string;
  scheduledPromptId?: Id<'chatroom_scheduledPrompts'>;
  plannerEnhancerEnabled?: boolean;
  userId: Id<'users'>;
  createdAt: number;
  expiresAt: number;
};

export type SubscribeOrchestrationIngressInput = {
  machineId: string;
  userId?: Id<'users'>;
  afterKey?: string;
  limit: number;
};

export type SubscribeOrchestrationIngressResult = {
  items: OrchestrationIngressSignal[];
  highKey: string | null;
  hasMore: boolean;
};

export type SubmitOrchestrationIngressInput = {
  chatroomId: Id<'chatroom_rooms'>;
  userId: Id<'users'>;
  content: string;
  targetRole?: string;
  attachedTaskIds?: Id<'chatroom_tasks'>[];
  attachedBacklogItemIds?: Id<'chatroom_backlog'>[];
  attachedMessageIds?: Id<'chatroom_messages'>[];
  attachedSnippets?: OrchestrationIngressSnippet[];
  sourcePlatform?: string;
  scheduledPromptId?: Id<'chatroom_scheduledPrompts'>;
  plannerEnhancerEnabled?: boolean;
};

export type SubmitOrchestrationIngressResult =
  | { ok: true; ingressId: string }
  | { ok: false; reason: 'flag_off' | 'host_unbound' | 'chatroom_not_active' | 'empty_content' };
