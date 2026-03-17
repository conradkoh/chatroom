import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { BacklogItemStatus } from '../../../../domain/entities/backlog-item';

/**
 * Represents an item from the dedicated chatroom_backlog table.
 * This is the canonical shared interface for all backlog UI components.
 */
export interface BacklogItem {
  _id: Id<'chatroom_backlog'>;
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  status: BacklogItemStatus;
  assignedTo?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
  legacyTaskId?: Id<'chatroom_tasks'>;
}
