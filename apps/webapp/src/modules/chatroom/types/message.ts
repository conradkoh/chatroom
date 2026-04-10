import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';

import type { ArtifactMeta } from '../components/ArtifactRenderer';

// ─── Shared message types ──────────────────────────────────────────────────────
// Used by both useMessageStore (hook) and MessageFeed (component) to ensure a
// single source of truth for message shapes flowing through the cursor-based
// loading pipeline.

export interface AttachedTask {
  _id: string;
  content: string;
  backlogStatus?: TaskStatus;
}

export interface AttachedBacklogItem {
  id: string;
  content: string;
  status: string;
}

export interface AttachedMessage {
  _id: string;
  content: string;
  senderRole: string;
  _creationTime: number;
}

/** Message shape used throughout the chatroom feed UI. */
export interface Message {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  classification?: 'question' | 'new_feature' | 'follow_up';
  taskId?: string;
  taskStatus?: 'pending' | 'in_progress' | 'backlog' | 'completed' | 'cancelled';
  /** Source platform for messages from external integrations (e.g. 'telegram') */
  sourcePlatform?: string;
  /** Feature metadata (only for new_feature classification) */
  featureTitle?: string;
  featureDescription?: string;
  featureTechSpecs?: string;
  /** Attached backlog tasks for context */
  attachedTasks?: AttachedTask[];
  /** Attached chatroom_backlog items for context (from "Attach to Context" button) */
  attachedBacklogItems?: AttachedBacklogItem[];
  /** Attached artifacts */
  attachedArtifacts?: ArtifactMeta[];
  /** Attached chatroom messages for context */
  attachedMessages?: AttachedMessage[];
  /** Attached workflows for visualizer */
  attachedWorkflows?: { _id: string; workflowKey: string; status: string }[];
  /** Latest progress message for inline display */
  latestProgress?: {
    content: string;
    senderRole: string;
    _creationTime: number;
  };
  /** Queued message flag (from chatroom_messageQueue) */
  isQueued?: boolean;
}
