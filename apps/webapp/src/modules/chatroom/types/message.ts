import type { TaskStatus } from '@workspace/backend/convex/lib/taskStateMachine';

import type { ArtifactMeta } from '../components/ArtifactRenderer';

// ─── Shared message types ──────────────────────────────────────────────────────
// Used by useMessages and ChatroomTimelineFeed to ensure a
// single source of truth for message shapes flowing through the cursor-based
// loading pipeline.

/** Classification of user messages — must match backend schema union */
export type MessageClassification = 'question' | 'new_feature' | 'follow_up';

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

export interface AttachedSnippet {
  reference: string;
  fileSource: string;
  selectedContent: string;
}

/** Message shape used throughout the chatroom feed UI. */
export interface Message {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  classification?: MessageClassification;
  taskId?: string;
  /**
   * Task status for UI display. Includes backend TaskStatus values plus 'cancelled'
   * which is inferred client-side when tasks leave the active set unexpectedly.
   */
  taskStatus?: TaskStatus | 'cancelled';
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
  /** Explorer file snippets attached via Cmd+I */
  attachedSnippets?: AttachedSnippet[];
  /** Latest progress message for inline display */
  latestProgress?: {
    content: string;
    senderRole: string;
    _creationTime: number;
  };
  /** Queued message flag (from chatroom_messageQueue) */
  isQueued?: boolean;
  /** Role that set the context (new-context messages only) */
  contextCreatedBy?: string;
  /** Original planner draft before enhancer (from job.draftContent); not stored on message row */
  enhancerOriginalContent?: string;
}
