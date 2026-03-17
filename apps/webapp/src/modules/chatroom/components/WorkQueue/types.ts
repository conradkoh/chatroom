import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import type { TeamLifecycle } from '../../types/readiness';

export type TaskStatus = 'pending' | 'acknowledged' | 'in_progress' | 'completed';

export type TaskOrigin = 'backlog' | 'chat';

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
  chatroomId: string;
  /** Lifecycle data from the parent — used to derive needsPromotion without a separate checkQueueHealth subscription */
  lifecycle?: TeamLifecycle | null;
}
