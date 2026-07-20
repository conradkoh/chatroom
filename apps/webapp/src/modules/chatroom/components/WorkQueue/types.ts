import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { TaskStatus, TaskOrigin } from '../../../../domain/entities/task';
import type { TeamLifecycle } from '../../types/readiness';

export type { TaskStatus, TaskOrigin };

export type BacklogStatus = 'not_started' | 'started' | 'complete' | 'closed';

export interface Task {
  _id: Id<'chatroom_tasks'>;
  content: string;
  status: TaskStatus;
  origin?: TaskOrigin;
  createdAt: number;
  updatedAt: number;
  queuePosition: number;
  assignedTo?: string;
  backlog?: {
    status: BacklogStatus;
  };
  // Scoring fields for prioritization
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
  priority?: number;
  // Source message attachments
  attachedTasks?: { _id: string; content: string; status: string }[];
  attachedBacklogItems?: { id: string; content: string; status: string }[];
  attachedMessages?: { _id: string; content: string; senderRole: string; _creationTime: number }[];
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
}

export interface TaskCounts {
  pending: number;
  acknowledged: number;
  in_progress: number;
  queued: number;
  backlog: number;
  pendingUserReview: number;
  completed: number;
}

export interface WorkQueueProps {
  chatroomId: Id<'chatroom_rooms'>;
  /** Lifecycle data from the parent — used to derive needsPromotion without a separate checkQueueHealth subscription */
  lifecycle?: TeamLifecycle | null;
  /** Optional ref to expose imperative open actions to parent (e.g. command palette) */
  onRegisterActions?: (actions: {
    openBacklog: () => void;
    openPendingReview: () => void;
    openBacklogCreate: () => void;
  }) => void;
  /** Called after a task is deleted so the timeline can evict linked messages immediately. */
  onTaskDeleted?: (taskId: string) => void;
}
