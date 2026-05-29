import type { Message } from '../types/message';

/** Discriminant for timeline row rendering (user, team, or context divider). */
export type TimelineEventKind = 'user_message' | 'team_message' | 'context';

/** Stable row identity for virtualization keys. */
export type TimelineEventId = string;

interface TimelineEventBase {
  id: TimelineEventId;
  kind: TimelineEventKind;
  /** Sort key — mirrors message `_creationTime`. */
  creationTime: number;
}

/** User-authored chat message (`senderRole=user`, `type=message`). */
export interface UserMessageTimelineEvent extends TimelineEventBase {
  kind: 'user_message';
  message: Message;
}

/** Agent/team traffic: handoffs, replies, and other non-user rows. */
export interface TeamMessageTimelineEvent extends TimelineEventBase {
  kind: 'team_message';
  message: Message;
}

/** Context boundary when a new context window is created. */
export interface ContextTimelineEvent extends TimelineEventBase {
  kind: 'context';
  message: Message;
}

export type TimelineEvent =
  | UserMessageTimelineEvent
  | TeamMessageTimelineEvent
  | ContextTimelineEvent;
